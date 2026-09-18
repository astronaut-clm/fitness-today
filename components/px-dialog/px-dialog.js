// 统一确认弹窗：遮罩 + 标题/正文 + 取消/确认按钮（样式用全局 .px-* 类）
// cancelText 传空串则隐藏取消按钮（单按钮场景）
// maskClose=false 用于「取消」本身有破坏性的弹窗（放弃进度等），避免误点遮罩就执行
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
    // 空实现：wxml 的 catchtap / catchtouchmove 需要一个存在的方法名来吞掉冒泡
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
