<template>
  <div
    class="email-split"
    ref="splitRef"
    :class="{
      'has-preview': showPreviewPane,
      resizing,
      'list-collapsed': listCollapsed && showPreviewPane
    }"
  >
    <div class="list-pane" v-show="!(listCollapsed && showPreviewPane)" :style="listPaneStyle">
      <slot />
    </div>
    <div
      v-if="isDesktop && showPreviewPane && !listCollapsed"
      class="split-resizer"
      @mousedown.prevent="startResize"
      @dblclick="resetWidth"
    >
      <button
        type="button"
        class="list-toggle"
        :title="$t('collapseEmailList')"
        @click.stop="collapseList"
        @mousedown.stop
      >
        <Icon icon="mdi:chevron-left" width="16" height="16" />
      </button>
    </div>
    <div
      v-else-if="isDesktop && showPreviewPane && listCollapsed"
      class="list-collapsed-bar"
      :title="$t('expandEmailList')"
      @click="expandList"
    >
      <Icon icon="mdi:chevron-right" width="18" height="18" />
      <span>{{ $t('emailList') }}</span>
    </div>
    <div
      v-else-if="isDesktop && !showPreviewPane"
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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
const listCollapsed = ref(false)

const showPreviewPane = computed(() => {
  return isDesktop.value && emailStore.previewOpen && !!emailStore.contentData.email
})

const listPaneStyle = computed(() => {
  if (!isDesktop.value || listCollapsed.value) return {}
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

function collapseList() {
  listCollapsed.value = true
}

function expandList() {
  listCollapsed.value = false
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
    listCollapsed.value = false
  }
  isDesktop.value = desktop
  if (desktop) {
    uiStore.emailListWidth = clampWidth(uiStore.emailListWidth || DEFAULT_LIST_WIDTH)
  }
}

watch(showPreviewPane, (open) => {
  if (!open) {
    listCollapsed.value = false
  }
})

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

  .list-collapsed-bar {
    display: none;
  }

  .preview-pane,
  .preview-empty {
    display: none;
  }

  @media (min-width: 1025px) {
    .split-resizer {
      display: flex;
      flex: 0 0 10px;
      width: 10px;
      margin-left: -4px;
      margin-right: -4px;
      position: relative;
      z-index: 2;
      cursor: col-resize;
      touch-action: none;
      align-items: center;
      justify-content: center;

      &::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 4px;
        width: 1px;
        background: var(--el-border-color-light);
        transition: background-color .15s ease, width .15s ease, left .15s ease;
      }

      &:hover::before,
      .resizing &::before {
        left: 3px;
        width: 3px;
        background: var(--el-color-primary);
      }

      .list-toggle {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 36px;
        padding: 0;
        border: 1px solid var(--el-border-color-light);
        border-radius: 10px;
        background: var(--el-bg-color);
        color: var(--el-text-color-regular);
        cursor: pointer;
        box-shadow: var(--el-box-shadow-light);

        &:hover {
          color: var(--el-color-primary);
          border-color: var(--el-color-primary);
        }
      }
    }

    .list-collapsed-bar {
      display: flex;
      flex: 0 0 36px;
      width: 36px;
      height: 100%;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      border-right: 1px solid var(--el-border-color-light);
      color: var(--el-text-color-regular);
      background: var(--el-bg-color);
      user-select: none;

      span {
        writing-mode: vertical-rl;
        font-size: 12px;
        letter-spacing: 2px;
      }

      &:hover {
        color: var(--el-color-primary);
        background: var(--el-fill-color-light);
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

    &.list-collapsed {
      .preview-pane {
        flex: 1;
      }
    }
  }
}
</style>
