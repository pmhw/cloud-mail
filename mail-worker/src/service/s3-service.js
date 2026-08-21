import { S3Client, PutObjectCommand, DeleteObjectsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import settingService from './setting-service';
import domainUtils from '../utils/domain-uitls';
import { settingConst } from '../const/entity-const';
import BizError from '../error/biz-error';

function wrapS3Error(err, action) {
	const msg = err?.message || String(err);
	const code = err?.name || err?.Code || err?.code || '';
	const detail = [code, msg].filter(Boolean).join(': ');
	console.error(`S3 ${action} failed:`, detail);
	throw new BizError(`对象存储${action}失败（${detail}）。请检查 S3 Endpoint/Region/密钥，京东云等兼容存储请开启 ForcePathStyle`);
}

const s3Service = {

	async putObj(c, key, content, metadata) {

		const client = await this.client(c);

		const { bucket } = await settingService.query(c);

		let obj = { Bucket: bucket, Key: key, Body: content,
			CacheControl: metadata.cacheControl
		}

		if (metadata.cacheControl) {
			obj.CacheControl = metadata.cacheControl
		}

		if (metadata.contentDisposition) {
			obj.ContentDisposition = metadata.contentDisposition
		}

		if (metadata.contentType) {
			obj.ContentType = metadata.contentType
		}

		try {
			await client.send(new PutObjectCommand(obj))
		} catch (err) {
			wrapS3Error(err, '上传');
		}
	},

	async deleteObj(c, keys) {

		if (typeof keys === 'string') {
			keys = [keys];
		}

		if (keys.length === 0) {
			return;
		}

		const client = await this.client(c);
		const { bucket } = await settingService.query(c);


		client.middlewareStack.add(
			(next) => async (args) => {

				const body = args.request.body

				// 计算 MD5 校验和并转换为 Base64 编码
				const encoder = new TextEncoder();
				const data = encoder.encode(body);

				// 使用 Web Crypto API 计算 MD5 校验和
				const hashBuffer = await crypto.subtle.digest('MD5', data);
				const hashArray = new Uint8Array(hashBuffer);
				const contentMD5 = btoa(String.fromCharCode.apply(null, hashArray));

				args.request.headers["Content-MD5"] = contentMD5;

				return next(args);
			},
			{ step: "build", name: "inspectRequestMiddleware" }
		);


		try {
			await client.send(
				new DeleteObjectsCommand({
					Bucket: bucket,
					Delete: {
						Objects: keys.map(key => ({ Key: key }))
					}
				})
			);
		} catch (err) {
			wrapS3Error(err, '删除');
		}
	},

	async getObj(c, key) {
		const client = await this.client(c);
		const { bucket } = await settingService.query(c);
		try {
			const result = await client.send(new GetObjectCommand({
				Bucket: bucket,
				Key: key
			}));

			return new Response(result.Body, {
				headers: {
					'Content-Type': result.ContentType || 'application/octet-stream',
					'Content-Disposition': result.ContentDisposition || null,
					'Cache-Control': result.CacheControl || null
				}
			});
		} catch (err) {
			wrapS3Error(err, '下载');
		}
	},


	async client(c) {
		const { region, endpoint, s3AccessKey, s3SecretKey, forcePathStyle } = await settingService.query(c);
		return new S3Client({
			region: region || 'auto',
			endpoint: domainUtils.toOssDomain(endpoint),
			forcePathStyle: forcePathStyle === settingConst.forcePathStyle.OPEN,
			// 新版 SDK 默认带 CRC32，京东云/MinIO 等兼容存储常因此返回 Access Denied
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED',
			credentials: {
				accessKeyId: s3AccessKey,
				secretAccessKey: s3SecretKey,
			}
		});
	}
}

export default s3Service
