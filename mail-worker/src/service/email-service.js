import orm from '../entity/orm';
import email from '../entity/email';
import { attConst, emailConst, isDel, settingConst } from '../const/entity-const';
import { and, desc, eq, gt, inArray, lt, count, asc, sql, ne, or, like, lte, gte } from 'drizzle-orm';
import { star } from '../entity/star';
import settingService from './setting-service';
import accountService from './account-service';
import BizError from '../error/biz-error';
import emailUtils from '../utils/email-utils';
import fileUtils from '../utils/file-utils';
import { Resend } from 'resend';
import attService from './att-service';
import { parseHTML } from 'linkedom';
import userService from './user-service';
import roleService from './role-service';
import user from '../entity/user';
import starService from './star-service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import kvConst from '../const/kv-const';
import { t } from '../i18n/i18n'
import domainUtils from '../utils/domain-uitls';
import account from "../entity/account";
import { att } from '../entity/att';
import telegramService from './telegram-service';

dayjs.extend(utc);

const emailService = {

	async list(c, params, userId) {

		let { emailId, type, accountId, size, timeSort, allReceive, spam } = params;

		size = Number(size);
		emailId = Number(emailId);
		timeSort = Number(timeSort);
		accountId = Number(accountId);
		allReceive = Number(allReceive);
		spam = Number(spam);
		type = Number(type);

		if (size > 50) {
			size = 50;
		}

		if (!emailId) {

			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}

		}

		if (isNaN(allReceive)) {
			let accountRow = await accountService.selectById(c, accountId);
			allReceive = accountRow.allReceive;
		}

		const spamCondition = type === emailConst.type.RECEIVE
			? eq(email.spam, spam === emailConst.spam.SPAM ? emailConst.spam.SPAM : emailConst.spam.NORMAL)
			: eq(1, 1);

		const query = orm(c)
			.select({
				...email,
				starId: star.starId
			})
			.from(email)
			.leftJoin(
				star,
				and(
					eq(star.emailId, email.emailId),
					eq(star.userId, userId)
				)
			).leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.userId, userId),
					timeSort ? gt(email.emailId, emailId) : lt(email.emailId, emailId),
					eq(email.type, type),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL),
					spamCondition
				)
			);

		if (timeSort) {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const listQuery = query.limit(size).all();

		const totalQuery = orm(c).select({ total: count() }).from(email)
			.leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.userId, userId),
					eq(email.type, type),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL),
					spamCondition
				)
		).get();

		const latestEmailQuery = orm(c).select().from(email).where(
			and(
				allReceive ? eq(1,1) : eq(email.accountId, accountId),
				eq(email.userId, userId),
				eq(email.type, type),
				eq(email.isDel, isDel.NORMAL),
				spamCondition
			))
			.orderBy(desc(email.emailId)).limit(1).get();

		let [list, totalRow, latestEmail] = await Promise.all([listQuery, totalQuery, latestEmailQuery]);

		list = list.map(item => ({
			...item,
			isStar: item.starId != null ? 1 : 0
		}));


		await this.emailAddAtt(c, list);

		if (!latestEmail) {
			latestEmail = {
				emailId: 0,
				accountId: accountId,
				userId: userId,
			}
		}

		return { list, total: totalRow.total, latestEmail };
	},

	async delete(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = emailIds.split(',').map(Number);
		const { syncDelete } = await settingService.query(c);

		if (syncDelete === settingConst.syncDelete.OPEN) {
			const owned = await orm(c).select({ emailId: email.emailId }).from(email)
				.where(and(eq(email.userId, userId), inArray(email.emailId, emailIdList)))
				.all();
			const ownedIds = owned.map(row => row.emailId);
			if (ownedIds.length) {
				await this.physicsDelete(c, { emailIds: ownedIds.join(',') });
			}
			return;
		}

		await orm(c).update(email).set({ isDel: isDel.DELETE }).where(
			and(
				eq(email.userId, userId),
				inArray(email.emailId, emailIdList)))
			.run();
	},

	receive(c, params, cidAttList, r2domain) {
		params.content = this.imgReplace(params.content, cidAttList, r2domain)
		return orm(c).insert(email).values({ ...params }).returning().get();
	},

	//邮件发送
	async send(c, params, userId) {

		let {
			accountId, //发送账号id
			name, //发件人名字
			sendType, //发件类型
			emailId, //邮件id，如果是回复邮件会带
			receiveEmail, //收件人邮箱
			cc = [], //抄送
			bcc = [], //密送
			text, //邮件纯文本
			content, //邮件内容
			subject, //邮件标题
			attachments = [], //附件
			scheduledAt //定时发送时间（UTC 字符串，可选）
		} = params;

		receiveEmail = this.normalizeEmailList(receiveEmail);
		cc = this.normalizeEmailList(cc);
		bcc = this.normalizeEmailList(bcc);

		// 去重：抄送/密送不重复收件人
		cc = cc.filter(email => !receiveEmail.includes(email));
		bcc = bcc.filter(email => !receiveEmail.includes(email) && !cc.includes(email));

		if (!receiveEmail.length) {
			throw new BizError(t('emptyEmail'));
		}

		const allRecipientEmails = [...receiveEmail, ...cc, ...bcc];
		const recipientCount = allRecipientEmails.length;

		const { resendTokens, r2Domain, send, domainList } = await settingService.query(c);

		let { imageDataList, html } = await attService.toImageUrlHtml(c, content);

		//判断是否关闭发件功能
		if (send === settingConst.send.CLOSE) {
			throw new BizError(t('disabledSend'), 403);
		}

		const userRow = await userService.selectById(c, userId);
		const roleRow = await roleService.selectById(c, userRow.type);

		//判断接收方是不是全部为站内邮箱
		const allInternal = allRecipientEmails.every(email => {
			const domain = '@' + emailUtils.getDomain(email);
			return domainList.includes(domain);
		});

		if (c.env.admin !== userRow.email) {

			//发件被禁用
			if (roleRow.sendType === 'ban') {
				throw new BizError(t('bannedSend'), 403);
			}

			//发件被禁用
			if (roleRow.sendType === 'internal' && !allInternal) {
				throw new BizError(t('onlyInternalSend'), 403);
			}

		}

		//如果不是管理员，权限设置了发送次数
		if (c.env.admin !== userRow.email && roleRow.sendCount) {

			if (userRow.sendCount >= roleRow.sendCount) {
				if (roleRow.sendType === 'day') throw new BizError(t('daySendLimit'), 403);
				if (roleRow.sendType === 'count') throw new BizError(t('totalSendLimit'), 403);
			}

			if (userRow.sendCount + recipientCount > roleRow.sendCount) {
				if (roleRow.sendType === 'day') throw new BizError(t('daySendLack'), 403);
				if (roleRow.sendType === 'count') throw new BizError(t('totalSendLack'), 403);
			}

		}

		const accountRow = await accountService.selectById(c, accountId);

		if (!accountRow) {
			throw new BizError(t('senderAccountNotExist'));
		}

		if (accountRow.userId !== userId) {
			throw new BizError(t('sendEmailNotCurUser'));
		}

		if (c.env.admin !== userRow.email) {
			//用户没有这个域名的使用权限
			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, accountRow.email)) {
				throw new BizError(t('noDomainPermSend'),403)
			}

		}

		const domain = emailUtils.getDomain(accountRow.email);
		const resendToken = resendTokens[domain];
		const useCloudflareEmail = !!c.env.email;

		//如果接收方存在站外邮箱，又没有发信服务
		if (!useCloudflareEmail && !resendToken && !allInternal) {
			throw new BizError(t('noSendProvider'));
		}

		//没有发件人名字自动截取
		if (!name) {
			name = emailUtils.getName(accountRow.email);
		}

		let emailRow = {
			messageId: null
		};

		//如果是回复邮件
		if (sendType === 'reply') {

			emailRow = await this.selectById(c, emailId);

			if (!emailRow) {
				throw new BizError(t('notExistEmailReply'));
			}

		}

		const scheduleTime = this.parseScheduleAt(scheduledAt);
		if (scheduleTime) {
			return await this.saveScheduledEmail(c, {
				userId,
				accountId,
				accountRow,
				name,
				subject,
				text,
				html,
				imageDataList,
				attachments,
				receiveEmail,
				cc,
				bcc,
				sendType,
				emailRow,
				r2Domain,
				scheduledAt: scheduleTime,
				recipientCount,
				roleRow
			});
		}

		let sendResult = {};

		//存在站外邮箱时，如果配置了 Cloudflare Email Service 就优先使用，否则使用 Resend
		if (!allInternal) {

			if (useCloudflareEmail) {
				sendResult = await this.sendByCloudflareEmail(c, {
					name,
					accountEmail: accountRow.email,
					receiveEmail,
					cc,
					bcc,
					subject,
					text,
					html,
					attachments: [...imageDataList, ...attachments],
					sendType,
					messageId: emailRow.messageId
				});
			} else {
				sendResult = await this.sendByResend(resendToken, {
					name,
					accountEmail: accountRow.email,
					receiveEmail,
					cc,
					bcc,
					subject,
					text,
					html,
					attachments: [...imageDataList, ...attachments],
					sendType,
					messageId: emailRow.messageId
				});
			}

		}

		const { data, error } = sendResult;


		if (error) {
			throw new BizError(error.message);
		}

		imageDataList = imageDataList.map(item => ({...item, contentId: `<${item.contentId}>`}))

		//把图片标签cid标签切换会通用url
		html = this.imgReplace(html, imageDataList, r2Domain);

		//封装数据保存到数据库
		const emailData = {};
		emailData.sendEmail = accountRow.email;
		emailData.name = name;
		emailData.subject = subject;
		emailData.content = html;
		emailData.text = text;
		emailData.accountId = accountId;
		emailData.status = useCloudflareEmail ? emailConst.status.DELIVERED : emailConst.status.SENT;
		emailData.type = emailConst.type.SEND;
		emailData.userId = userId;
		emailData.resendEmailId = data?.id;

		emailData.recipient = JSON.stringify(receiveEmail.map(item => ({ address: item, name: '' })));
		emailData.cc = JSON.stringify(cc.map(item => ({ address: item, name: '' })));
		emailData.bcc = JSON.stringify(bcc.map(item => ({ address: item, name: '' })));

		if (sendType === 'reply') {
			emailData.inReplyTo = emailRow.messageId;
			emailData.relation = emailRow.messageId;
		}

		//如果权限有发送次数增加用户发送次数
		if (roleRow.sendCount && roleRow.sendType !== 'internal') {
			await userService.incrUserSendCount(c, recipientCount, userId);
		}

		//保存到数据库并返回结果
		const emailResult = await orm(c).insert(email).values(emailData).returning().get();

		//保存内嵌附件
		if (imageDataList.length > 0) {
			if (imageDataList.length > 10) {
				throw new BizError(t('imageAttLimit'));
			}
			await attService.saveArticleAtt(c, imageDataList, userId, accountId, emailResult.emailId);
		}

		//保存普通附件
		if (attachments?.length > 0) {
			if (attachments.length > 10) {
				throw new BizError(t('attLimit'));
			}
			await attService.saveSendAtt(c, attachments, userId, accountId, emailResult.emailId);
		}

		const attList = await attService.selectByEmailIds(c, [emailResult.emailId]);
		emailResult.attList = attList;

		//如果全是站内接收方，直接写入数据库
		if (allInternal) {
			await this.HandleOnSiteEmail(c, receiveEmail, emailResult, attList, cc, bcc);
		}

		const dateStr = dayjs().format('YYYY-MM-DD');
		let daySendTotal = await c.env.kv.get(kvConst.SEND_DAY_COUNT + dateStr);

		//记录每天发件次数统计
		if (!daySendTotal) {
			await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(recipientCount), { expirationTtl: 60 * 60 * 24 });
		} else  {
			daySendTotal = Number(daySendTotal) + recipientCount
			await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(daySendTotal), { expirationTtl: 60 * 60 * 24 });
		}

		return [ emailResult ];
	},

	parseScheduleAt(scheduledAt) {
		if (!scheduledAt) {
			return null;
		}
		const time = dayjs(scheduledAt);
		if (!time.isValid()) {
			throw new BizError(t('invalidScheduleTime'));
		}
		if (time.isBefore(dayjs().add(1, 'minute'))) {
			throw new BizError(t('scheduleTimeTooSoon'));
		}
		if (time.isAfter(dayjs().add(30, 'day'))) {
			throw new BizError(t('scheduleTimeTooLate'));
		}
		return time.utc().format('YYYY-MM-DD HH:mm:ss');
	},

	async saveScheduledEmail(c, ctx) {
		let {
			userId, accountId, accountRow, name, subject, text, html,
			imageDataList, attachments, receiveEmail, cc, bcc,
			sendType, emailRow, r2Domain, scheduledAt, recipientCount, roleRow
		} = ctx;

		imageDataList = imageDataList.map(item => ({...item, contentId: `<${item.contentId}>`}))
		html = this.imgReplace(html, imageDataList, r2Domain);

		const emailData = {
			sendEmail: accountRow.email,
			name,
			subject,
			content: html,
			text,
			accountId,
			status: emailConst.status.SCHEDULED,
			type: emailConst.type.SEND,
			userId,
			scheduledAt,
			recipient: JSON.stringify(receiveEmail.map(item => ({ address: item, name: '' }))),
			cc: JSON.stringify(cc.map(item => ({ address: item, name: '' }))),
			bcc: JSON.stringify(bcc.map(item => ({ address: item, name: '' })))
		};

		if (sendType === 'reply') {
			emailData.inReplyTo = emailRow.messageId;
			emailData.relation = emailRow.messageId;
		}

		const emailResult = await orm(c).insert(email).values(emailData).returning().get();

		if (imageDataList.length > 0) {
			if (imageDataList.length > 10) {
				throw new BizError(t('imageAttLimit'));
			}
			await attService.saveArticleAtt(c, imageDataList, userId, accountId, emailResult.emailId);
		}

		if (attachments?.length > 0) {
			if (attachments.length > 10) {
				throw new BizError(t('attLimit'));
			}
			await attService.saveSendAtt(c, attachments, userId, accountId, emailResult.emailId);
		}

		const attList = await attService.selectByEmailIds(c, [emailResult.emailId]);
		emailResult.attList = attList;

		if (roleRow.sendCount && roleRow.sendType !== 'internal') {
			await userService.incrUserSendCount(c, recipientCount, userId);
		}

		return [ emailResult ];
	},

	async cancelSchedule(c, params, userId) {
		const emailId = Number(params.emailId);
		const emailRow = await this.selectById(c, emailId);
		if (!emailRow || emailRow.userId !== userId) {
			throw new BizError(t('notExistEmailReply'));
		}
		if (emailRow.status !== emailConst.status.SCHEDULED) {
			throw new BizError(t('notScheduledEmail'));
		}
		await this.delete(c, { emailIds: String(emailId) }, userId);
	},

	async processScheduled(c) {
		const now = dayjs().utc().format('YYYY-MM-DD HH:mm:ss');
		const list = await orm(c).select().from(email).where(
			and(
				eq(email.status, emailConst.status.SCHEDULED),
				eq(email.type, emailConst.type.SEND),
				lte(email.scheduledAt, now),
				eq(email.isDel, isDel.NORMAL)
			)
		).orderBy(asc(email.scheduledAt)).limit(20).all();

		for (const emailRow of list) {
			try {
				await this.dispatchScheduled(c, emailRow);
			} catch (e) {
				console.error(`定时发送失败 emailId=${emailRow.emailId}`, e);
				await orm(c).update(email).set({
					status: emailConst.status.FAILED,
					message: JSON.stringify({ message: e.message || String(e) })
				}).where(eq(email.emailId, emailRow.emailId)).run();
			}
		}
	},

	async dispatchScheduled(c, emailRow) {
		const claim = await c.env.db.prepare(
			`UPDATE email SET status = ? WHERE email_id = ? AND status = ?`
		).bind(emailConst.status.SENT, emailRow.emailId, emailConst.status.SCHEDULED).run();

		if (!claim.meta?.changes) {
			return;
		}

		const { resendTokens, r2Domain, domainList } = await settingService.query(c);
		const receiveEmail = this.normalizeEmailList(JSON.parse(emailRow.recipient || '[]'));
		const cc = this.normalizeEmailList(JSON.parse(emailRow.cc || '[]'));
		const bcc = this.normalizeEmailList(JSON.parse(emailRow.bcc || '[]'));
		const allRecipientEmails = [...receiveEmail, ...cc, ...bcc];
		const allInternal = allRecipientEmails.every(item => {
			const domain = '@' + emailUtils.getDomain(item);
			return domainList.includes(domain);
		});

		const domain = emailUtils.getDomain(emailRow.sendEmail);
		const resendToken = resendTokens[domain];
		const useCloudflareEmail = !!c.env.email;

		let html = (emailRow.content || '').replace(/\{\{domain\}\}/g, (domainUtils.toOssDomain(r2Domain) || '') + '/');
		const attachments = await attService.loadSendAttachments(c, emailRow.emailId);

		let sendResult = {};
		if (!allInternal) {
			if (useCloudflareEmail) {
				sendResult = await this.sendByCloudflareEmail(c, {
					name: emailRow.name,
					accountEmail: emailRow.sendEmail,
					receiveEmail,
					cc,
					bcc,
					subject: emailRow.subject,
					text: emailRow.text,
					html,
					attachments,
					sendType: emailRow.inReplyTo ? 'reply' : '',
					messageId: emailRow.inReplyTo
				});
			} else if (resendToken) {
				sendResult = await this.sendByResend(resendToken, {
					name: emailRow.name,
					accountEmail: emailRow.sendEmail,
					receiveEmail,
					cc,
					bcc,
					subject: emailRow.subject,
					text: emailRow.text,
					html,
					attachments,
					sendType: emailRow.inReplyTo ? 'reply' : '',
					messageId: emailRow.inReplyTo
				});
			} else {
				throw new BizError(t('noSendProvider'));
			}
		}

		const { data, error } = sendResult;
		if (error) {
			throw new BizError(error.message);
		}

		const status = useCloudflareEmail || allInternal
			? emailConst.status.DELIVERED
			: emailConst.status.SENT;

		await orm(c).update(email).set({
			status,
			resendEmailId: data?.id || null,
			scheduledAt: null
		}).where(eq(email.emailId, emailRow.emailId)).run();

		if (allInternal) {
			const emailResult = { ...emailRow, status, content: html };
			const attList = await attService.selectByEmailIds(c, [emailRow.emailId]);
			await this.HandleOnSiteEmail(c, receiveEmail, emailResult, attList, cc, bcc);
		}

		const recipientCount = allRecipientEmails.length;
		const dateStr = dayjs().format('YYYY-MM-DD');
		let daySendTotal = await c.env.kv.get(kvConst.SEND_DAY_COUNT + dateStr);
		if (!daySendTotal) {
			await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(recipientCount), { expirationTtl: 60 * 60 * 24 });
		} else {
			await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(Number(daySendTotal) + recipientCount), { expirationTtl: 60 * 60 * 24 });
		}
	},

	normalizeEmailList(list) {
		if (!list) {
			return [];
		}
		const arr = Array.isArray(list) ? list : [list];
		const result = [];
		for (const item of arr) {
			const email = typeof item === 'string' ? item.trim() : (item?.address || '').trim();
			if (email && !result.includes(email)) {
				result.push(email);
			}
		}
		return result;
	},

	async sendByCloudflareEmail(c, params) {
		const sendForm = {
			from: { email: params.accountEmail, name: params.name },
			to: [...params.receiveEmail],
			subject: params.subject
		};

		if (params.cc?.length) {
			sendForm.cc = [...params.cc];
		}

		if (params.bcc?.length) {
			sendForm.bcc = [...params.bcc];
		}

		if (params.text) {
			sendForm.text = params.text;
		}

		if (params.html) {
			sendForm.html = params.html;
		}

		const attachments = await this.toCloudflareAttachments(params.attachments);
		if (attachments.length > 0) {
			sendForm.attachments = attachments;
		}

		if (params.sendType === 'reply' && params.messageId) {
			sendForm.headers = {
				'in-reply-to': params.messageId,
				'references': params.messageId
			};
		}

		const result = await c.env.email.send(sendForm);

		return {
			data: {
				id: result.messageId
			}
		};
	},

	async sendByResend(resendToken, params) {
		const resend = new Resend(resendToken);

		const sendForm = {
			from: `${params.name} <${params.accountEmail}>`,
			to: [...params.receiveEmail],
			subject: params.subject,
			text: params.text,
			html: params.html,
			attachments: await this.toResendAttachments(params.attachments)
		};

		if (params.cc?.length) {
			sendForm.cc = [...params.cc];
		}

		if (params.bcc?.length) {
			sendForm.bcc = [...params.bcc];
		}

		if (params.sendType === 'reply') {
			sendForm.headers = {
				'in-reply-to': params.messageId,
				'references': params.messageId
			};
		}

		return await resend.emails.send(sendForm);
	},

	async toCloudflareAttachments(attachments) {
		const arrayBufferAttachments = await this.toArrayBufferAttachments(attachments);

		return arrayBufferAttachments.map(attachment => {
			const item = {
				content: attachment.content,
				filename: attachment.filename,
				type: attachment.mimeType || attachment.contentType || attachment.type || 'application/octet-stream',
				disposition: attachment.contentId ? 'inline' : 'attachment'
			};

			if (attachment.contentId) {
				item.contentId = attachment.contentId.replace(/^<|>$/g, '');
			}

			return item;
		});
	},

	async toResendAttachments(attachments = []) {
		const result = [];

		for (const attachment of attachments) {
			const content = await this.toAttachmentBase64(attachment);
			if (!content) {
				continue;
			}

			result.push({
				...attachment,
				content,
				contentType: attachment.contentType || attachment.mimeType || attachment.type || 'application/octet-stream'
			});
		}

		return result;
	},

	async toArrayBufferAttachments(attachments = []) {
		const result = [];

		for (const attachment of attachments) {
			const content = await this.toAttachmentArrayBuffer(attachment);
			if (!content) {
				continue;
			}

			result.push({ ...attachment, content });
		}

		return result;
	},

	async toAttachmentBase64(attachment) {
		let content = attachment.content;

		if (!content) {
			return null;
		}

		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				content = content.split(',')[1] || content;
			}
			return content.replace(/\s+/g, '');
		}

		const arrayBuffer = await this.toAttachmentArrayBuffer(attachment);
		if (!arrayBuffer) {
			return null;
		}

		const bytes = new Uint8Array(arrayBuffer);
		let binary = '';

		for (let i = 0; i < bytes.length; i += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		}

		return btoa(binary);
	},

	async toAttachmentArrayBuffer(attachment) {
		let content = attachment.content;

		if (!content) {
			return null;
		}

		if (content instanceof ArrayBuffer) {
			return content;
		}

		if (content instanceof Uint8Array) {
			return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
		}

		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				content = content.split(',')[1] || content;
			}
			return fileUtils.base64ToUint8Array(content.replace(/\s+/g, '')).buffer;
		}

		return content;
	},

	//处理站内邮件发送
	async HandleOnSiteEmail(c, receiveEmail, sendEmailData, attList, ccEmail = [], bccEmail = []) {

		const { noRecipient  } = await settingService.query(c);

		const deliverEmails = [...new Set([...(receiveEmail || []), ...(ccEmail || []), ...(bccEmail || [])])];

		//查询所有收件人账号信息
		let accountList = await orm(c).select().from(account).where(inArray(account.email, deliverEmails)).all();

		//查询所有收件人权限身份
		const userIds = accountList.map(accountRow => accountRow.userId);
		let roleList = await roleService.selectByUserIds(c, userIds);

		//封装数据库准备保存到数据库
		const emailDataList = [];

		for (const emailAddr of deliverEmails) {

			//把发件人邮件改成收件
			const emailValues = {...sendEmailData}
			emailValues.status = emailConst.status.RECEIVE;
			emailValues.type = emailConst.type.RECEIVE;
			emailValues.toEmail = emailAddr;
			emailValues.toName = emailUtils.getName(emailAddr);
			emailValues.emailId = null;
			// 站内副本不暴露密送列表
			emailValues.bcc = '[]';

			const accountRow = accountList.find(accountRow => accountRow.email === emailAddr);

			//如果收件人存在就把邮件信息改成收件人的
			if (accountRow) {

				//设置给收件人保存
				emailValues.userId = accountRow.userId;
				emailValues.accountId = accountRow.accountId;
				emailValues.type = emailConst.type.RECEIVE;
				emailValues.status = emailConst.status.RECEIVE;

				const roleRow = roleList.find(roleRow => roleRow.userId === accountRow.userId);

				let { banEmail, availDomain } = roleRow;

				//如果收件人没有这个域名的使用权限和有邮件拦截，就把邮件改为拒收状态
				if (emailAddr !== c.env.admin) {

					if (!roleService.hasAvailDomainPerm(availDomain, emailAddr)) {
						emailValues.status = emailConst.status.BOUNCED;
						emailValues.message = `The recipient <${emailAddr}> is not authorized to use this domain.`;
					} else if(roleService.isBanEmail(banEmail, sendEmailData.sendEmail)) {
						emailValues.status = emailConst.status.BOUNCED;
						emailValues.message = `The recipient <${emailAddr}> is disabled from receiving emails.`;
					}

				}

				emailDataList.push(emailValues);

			} else {

				//设置无收件人邮件信息
				emailValues.userId = 0;
				emailValues.accountId = 0;
				emailValues.type = emailConst.type.RECEIVE;
				emailValues.status = emailConst.status.NOONE;

				//如果无人收件关闭改为拒收
				if (noRecipient === settingConst.noRecipient.CLOSE) {
					emailValues.status = emailConst.status.BOUNCED;
					emailValues.message = `Recipient not found: <${emailAddr}>`;
				}

				emailDataList.push(emailValues);

			}

		}

		//保存邮件
		const receiveEmailList = emailDataList.filter(emailRow => emailRow.status === emailConst.status.RECEIVE || emailRow.status === emailConst.status.NOONE);

		for (const emailData of receiveEmailList) {

			const emailRow = await orm(c).insert(email).values(emailData).returning().get();

			//设置附件保存
			for (const attRow of attList) {
				const attValues = {...attRow};
				attValues.emailId = emailRow.emailId;
				attValues.accountId = emailRow.accountId;
				attValues.userId = emailRow.userId;
				attValues.attId = null;
				await orm(c).insert(att).values(attValues).run();
			}

		}

		const bouncedEmail = emailDataList.find(emailRow => emailRow.status === emailConst.status.BOUNCED);


		let status = emailConst.status.DELIVERED;
		let message = ''
		//如果有拒收邮件，就把发件人的邮件改成拒收
		if (bouncedEmail) {
			const messageJson = { message: bouncedEmail.message };
			message = JSON.stringify(messageJson);
			status = emailConst.status.BOUNCED;
		}

		await orm(c).update(email).set({ status, message: message }).where(eq(email.emailId, sendEmailData.emailId)).run();

	},

	imgReplace(content, cidAttList, r2domain) {

		if (!content) {
			return ''
		}

		const { document } = parseHTML(content);

		const images = Array.from(document.querySelectorAll('img'));

		const useAtts = []

		for (const img of images) {

			const src = img.getAttribute('src');
			if (src && src.startsWith('cid:') && cidAttList) {

				const cid = src.replace(/^cid:/, '');
				const attCidIndex = cidAttList.findIndex(cidAtt => cidAtt.contentId.replace(/^<|>$/g, '') === cid);

				if (attCidIndex > -1) {
					const cidAtt = cidAttList[attCidIndex];
					img.setAttribute('src', '{{domain}}' + cidAtt.key);
					useAtts.push(cidAtt)
				}

			}

			r2domain = domainUtils.toOssDomain(r2domain)

			if (src && src.startsWith(r2domain + '/')) {
				img.setAttribute('src', src.replace(r2domain + '/', '{{domain}}'));
			}

		}

		useAtts.forEach(att => {
			att.type = attConst.type.EMBED
		})

		return document.toString();
	},

	selectById(c, emailId) {
		return orm(c).select().from(email).where(
			and(eq(email.emailId, emailId),
				eq(email.isDel, isDel.NORMAL)))
			.get();
	},

	async latest(c, params, userId) {
		let { emailId, accountId, allReceive } = params;
		allReceive = Number(allReceive);

		if (isNaN(allReceive)) {
			let accountRow = await accountService.selectById(c, accountId);
			allReceive = accountRow.allReceive;
		}

		let list = await orm(c).select({...email}).from(email)
			.leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.userId, userId),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL),
					allReceive ? eq(1,1) : eq(email.accountId, accountId),
					eq(email.type, emailConst.type.RECEIVE),
					eq(email.spam, emailConst.spam.NORMAL)
				))
			.orderBy(desc(email.emailId))
			.limit(20);

		await this.emailAddAtt(c, list);

		return list;
	},

	async physicsDelete(c, params) {
		let { emailIds } = params;
		emailIds = emailIds.split(',').map(Number);
		await attService.removeByEmailIds(c, emailIds);
		await starService.removeByEmailIds(c, emailIds);
		await orm(c).delete(email).where(inArray(email.emailId, emailIds)).run();
	},

	async physicsDeleteUserIds(c, userIds) {
		await attService.removeByUserIds(c, userIds);
		await orm(c).delete(email).where(inArray(email.userId, userIds)).run();
	},

	updateEmailStatus(c, params) {
		const { status, resendEmailId, message } = params;
		return orm(c).update(email).set({
			status: status,
			message: message
		}).where(eq(email.resendEmailId, resendEmailId)).returning().get();
	},

	async selectUserEmailCountList(c, userIds, type, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: email.userId,
				count: count(email.emailId)
			})
			.from(email)
			.where(and(
				inArray(email.userId, userIds),
				eq(email.type, type),
				eq(email.isDel, del),
				ne(email.status, emailConst.status.SAVING),
			))
			.groupBy(email.userId);
		return result;
	},

	async allList(c, params) {

		let { emailId, size, name, subject, accountEmail, userEmail, type, timeSort } = params;

		size = Number(size);

		emailId = Number(emailId);
		timeSort = Number(timeSort);

		if (size > 50) {
			size = 50;
		}

		if (!emailId) {

			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}

		}

		const conditions = [];

		if (type === 'send') {
			conditions.push(eq(email.type, emailConst.type.SEND));
		}

		if (type === 'receive') {
			conditions.push(eq(email.type, emailConst.type.RECEIVE));
		}

		if (type === 'delete') {
			conditions.push(eq(email.isDel, isDel.DELETE));
		}

		if (type === 'noone') {
			conditions.push(eq(email.status, emailConst.status.NOONE));
		}

		if (userEmail) {
			conditions.push(sql`${user.email} COLLATE NOCASE LIKE ${'%'+ userEmail + '%'}`);
		}

		if (accountEmail) {
			conditions.push(
				or(
					sql`${email.toEmail} COLLATE NOCASE LIKE ${'%'+ accountEmail + '%'}`,
					sql`${email.sendEmail} COLLATE NOCASE LIKE ${'%'+ accountEmail + '%'}`,
				)
			)
		}

		if (name) {
			conditions.push(sql`${email.name} COLLATE NOCASE LIKE ${'%'+ name + '%'}`);
		}

		if (subject) {
			conditions.push(sql`${email.subject} COLLATE NOCASE LIKE ${'%'+ subject + '%'}`);
		}

		conditions.push(ne(email.status, emailConst.status.SAVING));

		const countConditions = [...conditions];

		if (timeSort) {
			conditions.unshift(gt(email.emailId, emailId));
		} else {
			conditions.unshift(lt(email.emailId, emailId));
		}

		const query = orm(c).select({ ...email, userEmail: user.email })
			.from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(and(...conditions));

		const queryCount = orm(c).select({ total: count() })
			.from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(and(...countConditions));

		if (timeSort) {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const listQuery = query.limit(size).all();
		const totalQuery = queryCount.get();
		const latestEmailQuery = orm(c).select().from(email)
			.where(and(
				eq(email.type, emailConst.type.RECEIVE),
				ne(email.status, emailConst.status.SAVING)
			))
			.orderBy(desc(email.emailId)).limit(1).get();

		let [list, totalRow, latestEmail] = await Promise.all([listQuery, totalQuery, latestEmailQuery]);

		await this.emailAddAtt(c, list);

		if (!latestEmail) {
			latestEmail = {
				emailId: 0,
				accountId: 0,
				userId: 0,
			}
		}

		return { list: list, total: totalRow.total, latestEmail };
	},

	async allEmailLatest(c, params) {

		const { emailId } = params;

		let list = await orm(c).select({...email, userEmail: user.email}).from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.type, emailConst.type.RECEIVE),
					ne(email.status, emailConst.status.SAVING)
				))
			.orderBy(desc(email.emailId))
			.limit(20);

		await this.emailAddAtt(c, list);

		return list;
	},

	async emailAddAtt(c, list) {

		const emailIds = list.map(item => item.emailId);

		if (emailIds.length > 0) {

			const attList = await attService.selectByEmailIds(c, emailIds);

			list.forEach(emailRow => {
				const atts = attList.filter(attRow => attRow.emailId === emailRow.emailId);
				emailRow.attList = atts;
			});
		}
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(email).set({ isDel: isDel.NORMAL }).where(eq(email.userId, userId)).run();
	},

	async completeReceive(c, status, emailId) {
		return await orm(c).update(email).set({
			isDel: isDel.NORMAL,
			status: status
		}).where(eq(email.emailId, emailId)).returning().get();
	},

	async completeReceiveAll(c) {
		await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.RECEIVE} WHERE status = ${emailConst.status.SAVING} AND EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
		await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.NOONE} WHERE status = ${emailConst.status.SAVING} AND NOT EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
	},

	async batchDelete(c, params) {
		let { sendName, sendEmail, toEmail, subject, startTime, endTime, type  } = params

		let right = type === 'left' || type === 'include'
		let left = type === 'include'

		const conditions = []

		if (sendName) {
			conditions.push(like(email.name,`${left ? '%' : ''}${sendName}${right ? '%' : ''}`))
		}

		if (subject) {
			conditions.push(like(email.subject,`${left ? '%' : ''}${subject}${right ? '%' : ''}`))
		}

		if (sendEmail) {
			conditions.push(like(email.sendEmail,`${left ? '%' : ''}${sendEmail}${right ? '%' : ''}`))
		}

		if (toEmail) {
			conditions.push(like(email.toEmail,`${left ? '%' : ''}${toEmail}${right ? '%' : ''}`))
		}

		if (startTime && endTime) {
			conditions.push(gte(email.createTime,`${startTime}`))
			conditions.push(lte(email.createTime,`${endTime}`))
		}

		if (conditions.length === 0) {
			return;
		}

		const emailIdsRow = await orm(c).select({emailId: email.emailId}).from(email).where(conditions.length > 1 ? and(...conditions) : conditions[0]).all();

		const emailIds = emailIdsRow.map(row => row.emailId);

		if (emailIds.length === 0){
			return;
		}

		await attService.removeByEmailIds(c, emailIds);

		await orm(c).delete(email).where(conditions.length > 1 ? and(...conditions) : conditions[0]).run();
	},

	async physicsDeleteByAccountId(c, accountId) {
		await attService.removeByAccountId(c, accountId);
		await orm(c).delete(email).where(eq(email.accountId, accountId)).run();
	},

	async read(c, params, userId) {
		const { emailIds } = params;
		await orm(c).update(email).set({ unread: emailConst.unread.READ }).where(and(eq(email.userId, userId), inArray(email.emailId, emailIds)));
	},

	async setSpam(c, params, userId) {
		const { emailIds, spam } = params;
		const spamFlag = Number(spam) === emailConst.spam.SPAM ? emailConst.spam.SPAM : emailConst.spam.NORMAL;
		await orm(c).update(email).set({ spam: spamFlag }).where(and(
			eq(email.userId, userId),
			eq(email.type, emailConst.type.RECEIVE),
			inArray(email.emailId, emailIds)
		));
	}
};

export default emailService;
