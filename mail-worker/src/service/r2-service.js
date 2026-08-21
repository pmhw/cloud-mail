import s3Service from './s3-service';
import settingService from './setting-service';
import kvObjService from './kv-obj-service';

const r2Service = {

	async storageType(c) {

		const setting = await settingService.query(c);
		const { bucket, endpoint, s3AccessKey, s3SecretKey } = setting;

		if (!!(bucket && endpoint && s3AccessKey && s3SecretKey)) {
			return 'S3';
		}

		if (c.env.r2) {
			return 'R2';
		}

		return 'KV';
	},

	async putObj(c, key, content, metadata) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.putObj(c, key, content, metadata);
		}

		if (storageType === 'R2') {
			await c.env.r2.put(key, content, {
				httpMetadata: { ...metadata }
			});
		}

		if (storageType === 'S3') {
			await s3Service.putObj(c, key, content, metadata);
		}

	},

	async getObj(c, key) {
		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			return await kvObjService.getObj(c, key);
		}

		if (storageType === 'R2') {
			return await c.env.r2.get(key);
		}

		if (storageType === 'S3') {
			return await s3Service.getObj(c, key);
		}
	},

	async toResponse(c, key) {
		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			const resp = await kvObjService.getObj(c, key);
			if (!resp) {
				return new Response('Not Found', { status: 404 });
			}
			return resp;
		}

		if (storageType === 'R2') {
			const obj = await c.env.r2.get(key);
			if (!obj) {
				return new Response('Not Found', { status: 404 });
			}
			const headers = new Headers();
			obj.writeHttpMetadata(headers);
			headers.set('etag', obj.httpEtag);
			if (!headers.has('Cache-Control')) {
				headers.set('Cache-Control', 'public, max-age=259200');
			}
			return new Response(obj.body, { headers });
		}

		if (storageType === 'S3') {
			const resp = await s3Service.getObj(c, key);
			if (!resp) {
				return new Response('Not Found', { status: 404 });
			}
			return resp;
		}

		return new Response('Not Found', { status: 404 });
	},

	async delete(c, key) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.deleteObj(c, key);
		}

		if (storageType === 'R2') {
			await c.env.r2.delete(key);
		}

		if (storageType === 'S3'){
			await s3Service.deleteObj(c, key);
		}

	}

};
export default r2Service;
