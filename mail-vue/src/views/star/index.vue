<template>
  <EmailSplit>
    <emailScroll type="star" ref="scroll"
                 :allow-star="false"
                 :cancel-success="cancelStar"
                 :getEmailList="starList"
                 :emailDelete="emailDelete"
                 :star-add="starAdd"
                 :star-cancel="starCancel"
                 @jump="jumpContent"
                 actionLeft="6px"
                 :show-account-icon="false"
    />
  </EmailSplit>
</template>

<script setup>
import emailScroll from "@/components/email-scroll/index.vue"
import EmailSplit from "@/components/email-split/index.vue"
import {emailDelete} from "@/request/email.js";
import {starAdd, starCancel, starList} from "@/request/star.js";
import {useEmailStore} from "@/store/email.js";
import {defineOptions, onMounted, onUnmounted, ref} from "vue";
import { openEmailPreview, clearEmailPreview } from "@/utils/email-preview.js";

defineOptions({
  name: 'star'
})

const scroll = ref({})
const emailStore = useEmailStore();

function jumpContent(email) {
  openEmailPreview(email, {
    delType: 'logic',
    showStar: true,
    showReply: true,
  })
}

function cancelStar(email) {
  emailStore.cancelStarEmailId = email.emailId
  scroll.value.deleteEmail([email.emailId])
  if (emailStore.selectedEmailId === email.emailId) {
    clearEmailPreview()
  }
}

onMounted(() => {
  emailStore.starScroll = scroll
})

onUnmounted(() => {
  clearEmailPreview()
})

</script>
