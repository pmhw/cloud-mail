<template>
  <EmailSplit>
    <emailScroll type="spam" ref="scroll"
                 :getEmailList="getEmailList"
                 :emailDelete="emailDelete"
                 :email-read="emailRead"
                 :email-spam="emailSpam"
                 :star-add="starAdd"
                 :star-cancel="starCancel"
                 :star-success="addStar"
                 :cancel-success="cancelStar"
                 :show-unread="true"
                 :time-sort="params.timeSort"
                 actionLeft="4px"
                 @jump="jumpContent"
    >
      <template #first>
        <Icon class="icon" @click="changeTimeSort" icon="material-symbols-light:timer-arrow-down-outline"
              v-if="params.timeSort === 0" width="28" height="28"/>
        <Icon class="icon" @click="changeTimeSort" icon="material-symbols-light:timer-arrow-up-outline" v-else
              width="28" height="28"/>
      </template>
    </emailScroll>
  </EmailSplit>
</template>

<script setup>
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import emailScroll from "@/components/email-scroll/index.vue"
import EmailSplit from "@/components/email-split/index.vue"
import {emailList, emailDelete, emailRead, emailSpam} from "@/request/email.js";
import {starAdd, starCancel} from "@/request/star.js";
import {defineOptions, onMounted, onUnmounted, reactive, ref, watch} from "vue";
import {Icon} from "@iconify/vue";
import { openEmailPreview, clearEmailPreview } from "@/utils/email-preview.js";

defineOptions({
  name: 'spam'
})

const emailStore = useEmailStore();
const accountStore = useAccountStore();
const scroll = ref({})
const params = reactive({
  timeSort: 0,
})

onMounted(() => {
  emailStore.spamScroll = scroll
})

onUnmounted(() => {
  clearEmailPreview()
})

watch(() => accountStore.currentAccountId, () => {
  clearEmailPreview()
  scroll.value.refreshList();
})

function changeTimeSort() {
  params.timeSort = params.timeSort ? 0 : 1
  scroll.value.refreshList();
}

function jumpContent(email) {
  openEmailPreview(email, {
    delType: 'logic',
    showUnread: true,
    showStar: true,
    showReply: true,
  })
}

function addStar(email) {
  emailStore.starScroll?.addItem(email)
}

function cancelStar(email) {
  emailStore.starScroll?.deleteEmail([email.emailId])
}

function getEmailList(emailId, size) {
  const accountId = accountStore.currentAccountId;
  const allReceive = accountStore.currentAccount.allReceive;
  return emailList(accountId, allReceive, emailId, params.timeSort, size, 0, 1).then(data => {
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  })
}
</script>
<style>
.icon {
  cursor: pointer;
}
</style>
