import {useSettingStore} from "@/store/setting.js";
export function cvtR2Url(key) {

    if (!key) {
        return ''
    }

    if (key.startsWith('https://') || key.startsWith('http://')) {
        return key
    }

    const { settings } = useSettingStore();

    let domain = settings.r2Domain

    // 未配置访问域名时，走当前站点同源下载（Worker 再转发到 R2/S3/KV）
    if (!domain) {
        return key.startsWith('/') ? key : '/' + key
    }

    if (!domain.startsWith('http')) {
        return 'https://' + domain.replace(/\/$/, '') + '/' + key.replace(/^\//, '')
    }

    if (domain.endsWith("/")) {
        domain = domain.slice(0, -1);
    }
    return domain + '/' + key.replace(/^\//, '')
}

export function toOssDomain(domain) {

    if (!domain) {
        return ''
    }

    if (!domain.startsWith('http')) {
        return 'https://' + domain
    }

    if (domain.endsWith("/")) {
        domain = domain.slice(0, -1);
    }

    return domain
}
