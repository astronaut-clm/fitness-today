// 统一确认弹窗，样式用全局 .px-* 类。
// cancelText 传空串即单按钮；maskClose=false 用于「取消」本身有破坏性的场景（放弃进度等）
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    copy: { type: String, value: '' },
    cancelText: { type: String, value: '取消' },
    confirmText: { type: String, value: '确定' },
    danger: { type: Boolean, value: false },
    maskClose: { type: Boolean, value: true }
  },
  methods: {
    // wxml 的 catchtap / catchtouchmove 需要一个存在的方法名来吞冒泡
    noop() {},
    onMask() {
      if (this.data.maskClose) this.triggerEvent('cancel')
    },
    onCancel() {
      this.triggerEvent('cancel')
    },
    onConfirm() {
      this.triggerEvent('confirm')
    }
  }
})
