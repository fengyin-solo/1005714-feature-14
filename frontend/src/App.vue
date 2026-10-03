<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">变电站继电保护定值整定与二次设备检修管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向变电站台账、保护装置、定值整定与核对、二次回路检查、保护校验、故障录波分析、主变检修与直流系统监测的一体化电网二次设备运维管理工作台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "变电站台账", path: "/substation" }, { label: "保护装置台账", path: "/protectiondevice" }, { label: "定值整定", path: "/settingvalue" }, { label: "定值核对", path: "/settingcheck" }, { label: "二次回路检查", path: "/secondarycircuit" }, { label: "保护校验", path: "/relaytest" }, { label: "故障录波", path: "/faultrecord" }, { label: "保护动作统计", path: "/tripstat" }, { label: "主变检修", path: "/transformermaint" }, { label: "主变检修排期单", path: "/schedulesheet" }, { label: "断路器维护", path: "/breaker" }, { label: "直流系统监测", path: "/dcsystem" }, { label: "绝缘试验", path: "/insulationtest" }, { label: "缺陷处置", path: "/defect" }, { label: "工作票许可", path: "/workpermit" }, { label: "设备巡视", path: "/patrol" }, { label: "计量装置核查", path: "/meteringcheck" }, { label: "定值审批", path: "/settingapprove" }, { label: "安全工器具检定", path: "/safetytool" }]
</script>
