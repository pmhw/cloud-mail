import { useEmailStore } from '@/store/email.js'
import router from '@/router/index.js'

export const EMAIL_PREVIEW_BREAKPOINT = 1025

export function isDesktopEmailPreview() {
  return window.innerWidth >= EMAIL_PREVIEW_BREAKPOINT
}

export function openEmailPreview(email, flags = {}) {
  const emailStore = useEmailStore()
  emailStore.contentData.email = email
  emailStore.contentData.delType = flags.delType ?? 'logic'
  emailStore.contentData.showStar = flags.showStar ?? true
  emailStore.contentData.showReply = flags.showReply ?? true
  emailStore.contentData.showUnread = flags.showUnread ?? false
  emailStore.selectedEmailId = email?.emailId || 0

  if (isDesktopEmailPreview()) {
    emailStore.previewOpen = true
    return
  }

  emailStore.previewOpen = false
  router.push(flags.route || '/mail')
}

export function clearEmailPreview() {
  const emailStore = useEmailStore()
  emailStore.previewOpen = false
  emailStore.selectedEmailId = 0
  emailStore.contentData.email = null
  emailStore.contentData.showUnread = false
}
