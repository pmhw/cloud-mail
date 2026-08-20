<template>
  <div class="email-split" :class="{ 'has-preview': showPreviewPane }">
    <div class="list-pane">
      <slot />
    </div>
    <div class="preview-pane" v-if="showPreviewPane">
      <ContentView :key="emailStore.selectedEmailId" embedded />
    </div>
    <div class="preview-empty" v-else-if="isDesktop">
      <Icon icon="fluent:mail-read-20-regular" width="48" height="48" />
      <div>{{ $t('selectEmailToPreview') }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import ContentView from '@/views/content/index.vue'
import { useEmailStore } from '@/store/email.js'
import { clearEmailPreview, EMAIL_PREVIEW_BREAKPOINT } from '@/utils/email-preview.js'

const emailStore = useEmailStore()
const isDesktop = ref(window.innerWidth >= EMAIL_PREVIEW_BREAKPOINT)

const showPreviewPane = computed(() => {
  return isDesktop.value && emailStore.previewOpen && !!emailStore.contentData.email
})

function onResize() {
  const desktop = window.innerWidth >= EMAIL_PREVIEW_BREAKPOINT
  if (isDesktop.value && !desktop) {
    clearEmailPreview()
  }
  isDesktop.value = desktop
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped lang="scss">
.email-split {
  height: 100%;
  display: flex;
  min-width: 0;
  overflow: hidden;

  .list-pane {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  .preview-pane,
  .preview-empty {
    display: none;
  }

  @media (min-width: 1025px) {
    &.has-preview .list-pane {
      flex: 0 0 min(420px, 38%);
      max-width: 480px;
      border-right: 1px solid var(--el-border-color-light);
    }

    .preview-pane {
      display: block;
      flex: 1;
      min-width: 0;
      height: 100%;
      overflow: hidden;
    }

    .preview-empty {
      display: flex;
      flex: 1;
      min-width: 0;
      height: 100%;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--secondary-text-color);
      border-left: 1px solid var(--el-border-color-light);
    }
  }
}
</style>
