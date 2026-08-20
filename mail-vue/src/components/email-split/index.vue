<template>
  <div class="email-split" ref="splitRef" :class="{ 'has-preview': showPreviewPane, resizing }">
    <div class="list-pane" :style="listPaneStyle">
      <slot />
    </div>
    <div
      v-if="isDesktop"
      class="split-resizer"
      @mousedown.prevent="startResize"
      @dblclick="resetWidth"
    />
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
import { useUiStore } from '@/store/ui.js'
import { clearEmailPreview, EMAIL_PREVIEW_BREAKPOINT } from '@/utils/email-preview.js'

const DEFAULT_LIST_WIDTH = 420
const MIN_LIST_WIDTH = 280
const MIN_PREVIEW_WIDTH = 360

const emailStore = useEmailStore()
const uiStore = useUiStore()
const splitRef = ref(null)
const isDesktop = ref(window.innerWidth >= EMAIL_PREVIEW_BREAKPOINT)
const resizing = ref(false)

const showPreviewPane = computed(() => {
  return isDesktop.value && emailStore.previewOpen && !!emailStore.contentData.email
})

const listPaneStyle = computed(() => {
  if (!isDesktop.value) return {}
  return {
    flex: `0 0 ${uiStore.emailListWidth}px`,
    width: `${uiStore.emailListWidth}px`,
    maxWidth: 'none'
  }
})

function clampWidth(width) {
  const total = splitRef.value?.clientWidth || window.innerWidth
  const maxList = Math.max(MIN_LIST_WIDTH, total - MIN_PREVIEW_WIDTH)
  return Math.min(Math.max(width, MIN_LIST_WIDTH), maxList)
}

function startResize(e) {
  resizing.value = true
  const startX = e.clientX
  const startWidth = uiStore.emailListWidth

  const onMove = (event) => {
    uiStore.emailListWidth = clampWidth(startWidth + event.clientX - startX)
  }

  const onUp = () => {
    resizing.value = false
    uiStore.emailListWidth = clampWidth(uiStore.emailListWidth)
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function resetWidth() {
  uiStore.emailListWidth = DEFAULT_LIST_WIDTH
}

function onResize() {
  const desktop = window.innerWidth >= EMAIL_PREVIEW_BREAKPOINT
  if (isDesktop.value && !desktop) {
    clearEmailPreview()
  }
  isDesktop.value = desktop
  if (desktop) {
    uiStore.emailListWidth = clampWidth(uiStore.emailListWidth || DEFAULT_LIST_WIDTH)
  }
}

onMounted(() => {
  if (!uiStore.emailListWidth) {
    uiStore.emailListWidth = DEFAULT_LIST_WIDTH
  } else {
    uiStore.emailListWidth = clampWidth(uiStore.emailListWidth)
  }
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

  &.resizing {
    cursor: col-resize;
    user-select: none;

    .list-pane,
    .preview-pane,
    .preview-empty {
      pointer-events: none;
    }
  }

  .list-pane {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  .split-resizer {
    display: none;
  }

  .preview-pane,
  .preview-empty {
    display: none;
  }

  @media (min-width: 1025px) {
    .split-resizer {
      display: block;
      flex: 0 0 6px;
      width: 6px;
      margin-left: -3px;
      margin-right: -3px;
      position: relative;
      z-index: 2;
      cursor: col-resize;
      touch-action: none;

      &::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 2px;
        width: 1px;
        background: var(--el-border-color-light);
        transition: background-color .15s ease, width .15s ease, left .15s ease;
      }

      &:hover::before,
      .resizing &::before {
        left: 1px;
        width: 3px;
        background: var(--el-color-primary);
      }
    }

    .list-pane {
      border-right: none;
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
    }
  }
}
</style>
