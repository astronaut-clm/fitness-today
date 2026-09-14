// 训练计划库（内置演示数据）。scene: home / gym；loop>1 表示整组循环重复轮数。


const scenes = [
  { value: 'home', name: '居家' },
  { value: 'gym', name: '健身房' }
]

const plans = [
  {
    id: 'home_wakeup',
    name: '晨间唤醒',
    scene: 'home',
    level: '初级',
    duration: 8,
    calories: 50,
    tags: ['晨间', '全身'],
    summary: '低强度全身激活，唤醒身体与心肺，为一天注入能量。',
    notice: '起床后先喝一杯温水再开始；动作间休息 15-20 秒，保持顺畅呼吸。',
    loop: 1,
    exercises: [
      { actionId: 'jumping_jack', sets: 2, reps: '20秒' },
      { actionId: 'squat', sets: 2, reps: '12次' },
      { actionId: 'glute_bridge', sets: 2, reps: '12次' },
      { actionId: 'plank', sets: 2, reps: '20秒' }
    ]
  },
  {
    id: 'home_full_burn',
    name: '居家全身燃脂',
    scene: 'home',
    level: '初级',
    duration: 20,
    calories: 130,
    tags: ['燃脂', '全身'],
    summary: '无需器械的全身循环训练，心率与力量兼顾，减脂入门首选。',
    notice: '完成一轮动作后休息 60 秒，再进入下一轮，共完成 3 轮；最后一轮请拼尽全力。',
    loop: 3,
    exercises: [
      { actionId: 'jumping_jack', sets: 1, reps: '30秒' },
      { actionId: 'squat', sets: 1, reps: '15次' },
      { actionId: 'pushup', sets: 1, reps: '8-10次' },
      { actionId: 'mountain_climber', sets: 1, reps: '30秒' },
      { actionId: 'plank', sets: 1, reps: '30秒' }
    ]
  },
  {
    id: 'home_core',
    name: '核心强化训练',
    scene: 'home',
    level: '中级',
    duration: 15,
    calories: 95,
    tags: ['核心', '塑形'],
    summary: '针对腹部与腰背深层的核心循环，提升稳定与体态。',
    notice: '每轮结束后休息 45 秒，共完成 3 轮；卷腹时务必用腹部发力而非颈部。',
    loop: 3,
    exercises: [
      { actionId: 'plank', sets: 1, reps: '40秒' },
      { actionId: 'crunch', sets: 1, reps: '15次' },
      { actionId: 'mountain_climber', sets: 1, reps: '30秒' },
      { actionId: 'glute_bridge', sets: 1, reps: '15次' }
    ]
  },
  {
    id: 'home_lower',
    name: '下肢线条塑形',
    scene: 'home',
    level: '中级',
    duration: 22,
    calories: 140,
    tags: ['臀腿', '塑形'],
    summary: '深蹲与弓步组合的臀腿循环，紧致大腿、提升臀线。',
    notice: '每轮完成后休息 60 秒，共完成 4 轮；膝盖不适时减小下蹲幅度。',
    loop: 4,
    exercises: [
      { actionId: 'squat', sets: 1, reps: '15次' },
      { actionId: 'lunge', sets: 1, reps: '每侧10次' },
      { actionId: 'glute_bridge', sets: 1, reps: '20次' },
      { actionId: 'wall_sit', sets: 1, reps: '30秒' }
    ]
  },
  {
    id: 'gym_chest',
    name: '胸部泵感日',
    scene: 'gym',
    level: '中级',
    duration: 45,
    calories: 260,
    tags: ['胸部', '增肌'],
    summary: '卧推为核心搭配飞鸟收尾，充分刺激胸肌并追求泵感。',
    notice: '训练前用轻重量卧推热身 2 组；卧推重量较大时务必请同伴保护。',
    loop: 1,
    exercises: [
      { actionId: 'bench_press', sets: 4, reps: '8-12次', rest: '组间90秒' },
      { actionId: 'dumbbell_fly', sets: 3, reps: '12次', rest: '组间60秒' },
      { actionId: 'pushup', sets: 3, reps: '力竭', rest: '组间60秒' }
    ]
  },
  {
    id: 'gym_back',
    name: '背部打造日',
    scene: 'gym',
    level: '中级',
    duration: 45,
    calories: 250,
    tags: ['背部', '增肌'],
    summary: '从硬拉开始建立全身张力，再用下拉与划船打造背部的宽与厚。',
    notice: '硬拉从轻重量开始逐组加重；下拉与划船注意沉肩、避免耸肩代偿。',
    loop: 1,
    exercises: [
      { actionId: 'deadlift', sets: 4, reps: '6-8次', rest: '组间120秒' },
      { actionId: 'pull_down', sets: 4, reps: '10-12次', rest: '组间90秒' },
      { actionId: 'seated_row', sets: 3, reps: '12次', rest: '组间60秒' }
    ]
  },
  {
    id: 'gym_full_body',
    name: '器械全身入门',
    scene: 'gym',
    level: '初级',
    duration: 50,
    calories: 280,
    tags: ['全身', '新手'],
    summary: '覆盖推、拉、蹲的全身计划，新手熟悉器械与动作模式的完美开端。',
    notice: '所有器械重量从轻开始，先把动作模式做对；组间休息 60-90 秒。',
    loop: 1,
    exercises: [
      { actionId: 'squat', sets: 3, reps: '12次', rest: '组间90秒' },
      { actionId: 'bench_press', sets: 3, reps: '10次', rest: '组间90秒' },
      { actionId: 'pull_down', sets: 3, reps: '10次', rest: '组间90秒' },
      { actionId: 'shoulder_press', sets: 3, reps: '10次', rest: '组间60秒' },
      { actionId: 'plank', sets: 3, reps: '30秒', rest: '组间45秒' }
    ]
  },
  {
    id: 'gym_arm_shoulder',
    name: '手臂肩部雕刻',
    scene: 'gym',
    level: '中级',
    duration: 40,
    calories: 220,
    tags: ['手臂', '肩部'],
    summary: '肩推搭配二头弯举与三头下压，让手臂与肩部线条更立体。',
    notice: '弯举与下压属于孤立动作，重量宁轻勿重，确保动作轨迹完整。',
    loop: 1,
    exercises: [
      { actionId: 'shoulder_press', sets: 4, reps: '10次', rest: '组间90秒' },
      { actionId: 'dumbbell_curl', sets: 3, reps: '12次', rest: '组间60秒' },
      { actionId: 'pushdown', sets: 3, reps: '12次', rest: '组间60秒' },
      { actionId: 'pushup', sets: 3, reps: '力竭', rest: '组间60秒' }
    ]
  }
]

function listByScene(scene) {
  return plans.filter(function (p) {
    return p.scene === scene
  })
}

function getPlan(id) {
  for (let i = 0; i < plans.length; i++) {
    if (plans[i].id === id) return plans[i]
  }
  return null
}

function sceneName(scene) {
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].value === scene) return scenes[i].name
  }
  return ''
}

module.exports = {
  plans: plans,
  listByScene: listByScene,
  getPlan: getPlan,
  sceneName: sceneName
}
