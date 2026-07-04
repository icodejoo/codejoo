<script setup lang="ts">
import { computed } from "vue";
import { Button as VanButton, Dialog as VanDialog, Popup as VanPopup, showToast } from "vant";

import type { OverlayInstance } from "@codejoo/layerman";
import { useOverlay, useOverlays } from "@codejoo/layerman/vue";

import { om } from "./overlay";

const { active, queued } = useOverlays();

type Action = { testid: string; label: string; run: () => void };
type CardData = { text: string; action?: Action };
const asCard = (o: OverlayInstance) => o.data as CardData;
const hasText = (o: OverlayInstance) => typeof (o.data as CardData | undefined)?.text === "string";

// 串行卡片（串行槽，非 overlap，一次一个）用 Vant Popup 渲染
const serial = computed(() => active.value.find((o) => !o.overlapping && hasText(o)));
// overlap 卡片（可多个同时叠加）
const overlaps = computed(() => active.value.filter((o) => o.overlapping && hasText(o)));

let n = 0;

// —— 串行队列 ——
const queueThree = () => {
  for (let i = 0; i < 3; i++) {
    const k = ++n;
    om.open({ id: `card-${k}`, data: { text: `串行 #${k}` } as CardData });
  }
};

// —— replace：串行槽内互斥（A 里点按钮 → B 抢占 A，A 退回队列）——
const replaceDemo = () => {
  om.open({
    id: "repA",
    data: {
      text: "A —— 点下方按钮替换",
      action: { testid: "do-replace", label: "replace 成 B", run: () => om.open({ id: "repB", replace: true, data: { text: "B —— 已抢占 A" } as CardData }) },
    } as CardData,
  });
};

// —— overlap：Dialog A 内点按钮再叠加 Dialog B（两个弹窗同时可见）——
const dlgA = useOverlay("dlgA", { overlap: true });
const dlgB = useOverlay("dlgB", { overlap: true });

// —— 确认 + await 结果 ——
const confirm = useOverlay("confirm", { overlap: true });
const askConfirm = async () => {
  const ok = await confirm.open().result;
  showToast(ok === true ? "已确认 ✅" : "已取消 ❌");
};

// —— 程序驱动 / 数据驱动（无需逐个点击，由代码自动编排）——
const dataDriven = () => {
  // 模拟后端返回一批需要展示的通知，程序一次性 overlap 叠加
  om.open({ id: "srv-1", overlap: true, data: { text: "程序驱动 overlap #1" } as CardData });
  om.open({ id: "srv-2", overlap: true, data: { text: "程序驱动 overlap #2" } as CardData });
};
const backendResolve = () => {
  showToast("请求后端数据…"); // 立即反馈：resolve 期间弹窗尚未出现
  // resolve：串行入队，轮到它才“请求后端”，拿到数据后自动展示（overlap 是立即显示、不走队列，故不能带 resolve）
  om.open({
    id: "srv-r",
    resolve: async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { text: "resolve 拿到的后端数据" } as CardData;
    },
  });
};
</script>

<template>
  <div style="padding: 20px; font-family: system-ui; max-width: 480px; margin: 0 auto">
    <h2>@codejoo/layerman × Vant</h2>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0">
      <VanButton size="small" type="primary" data-testid="queue" @click="queueThree">串行入队 3 个</VanButton>
      <VanButton size="small" type="danger" data-testid="replace-demo" @click="replaceDemo">replace 互斥演示</VanButton>
      <VanButton size="small" type="warning" data-testid="open-a" @click="dlgA.open()">overlap 叠加(A)</VanButton>
      <VanButton size="small" type="success" data-testid="confirm-btn" @click="askConfirm">Vant Dialog 确认</VanButton>
      <VanButton size="small" data-testid="pause" @click="om.pauseAll()">暂停(冻结)</VanButton>
      <VanButton size="small" data-testid="resume" @click="om.resumeAll()">恢复</VanButton>
      <VanButton size="small" data-testid="data-driven" @click="dataDriven">程序驱动叠加</VanButton>
      <VanButton size="small" data-testid="backend-resolve" @click="backendResolve">后端 resolve</VanButton>
      <VanButton size="small" data-testid="clear" @click="om.clear({ closeActive: true })">clear</VanButton>
    </div>

    <div data-testid="state" style="font-size: 13px; color: #555; line-height: 1.8">
      <div>
        活跃: <b data-testid="active">{{ active.map((o) => `${o.id}(${o.phase})`).join(", ") || "—" }}</b>
      </div>
      <div>
        队列: <b data-testid="queued">{{ queued.join(", ") || "—" }}</b>
      </div>
    </div>

    <!-- 串行卡片：Vant Popup + 点蒙层关闭（close-on-click-overlay），验证非按钮关闭也能推进队列 -->
    <VanPopup :show="serial !== undefined" position="center" round :close-on-click-overlay="true" :overlay-style="{ background: 'rgba(0,0,0,.5)' }" data-testid="serial-popup" @click-overlay="serial && om.remove(serial.id)">
      <div v-if="serial" data-testid="serial-card" style="padding: 24px 28px; min-width: 220px; text-align: center">
        <p data-testid="serial-text" style="font-size: 16px; font-weight: 600; margin: 0 0 12px">{{ asCard(serial).text }}</p>
        <VanButton v-if="asCard(serial).action" size="mini" type="danger" :data-testid="asCard(serial).action!.testid" @click="asCard(serial).action!.run()">{{ asCard(serial).action!.label }}</VanButton>
        <VanButton size="mini" type="primary" data-testid="serial-close" @click="om.close(serial.id)">按钮关闭</VanButton>
      </div>
    </VanPopup>

    <!-- overlap 卡片：可多个同时叠加显示，带进/退场动画；用 stackIndex 计算层叠偏移与 z-index -->
    <Transition name="fade">
      <div v-if="overlaps.length" data-testid="overlap-layer" style="position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.5)">
        <div style="position: relative">
          <TransitionGroup name="pop">
            <div
              v-for="o in overlaps"
              :key="o.instanceKey"
              data-testid="overlap-card"
              :style="{ position: o.stackIndex ? 'absolute' : 'relative', top: `${o.stackIndex * 22}px`, left: `${o.stackIndex * 22}px`, zIndex: o.stackIndex, background: '#fff', padding: '20px 26px', borderRadius: '12px', minWidth: '220px', textAlign: 'center', boxShadow: '0 6px 24px #0005', pointerEvents: o.isTopmost ? 'auto' : 'none' }"
            >
              <p style="font-weight: 600; margin: 0 0 12px">{{ asCard(o).text }}<span v-if="o.isTopmost" style="color: #07c160"> ▲顶层</span></p>
              <VanButton size="mini" @click="om.close(o.id)">关闭</VanButton>
            </div>
          </TransitionGroup>
        </div>
      </div>
    </Transition>

    <!-- overlap 叠加：Dialog A（其内可再叠 B）+ Dialog B -->
    <VanDialog v-model:show="dlgA.model.value" title="Dialog A" show-cancel-button @cancel="dlgA.close()">
      <div style="padding: 20px; text-align: center">
        <p data-testid="dlgA-body">我是 A。点下面按钮在我之上再叠加 B：</p>
        <VanButton size="small" type="warning" data-testid="stack-b" @click="dlgB.open()">叠加 Dialog B</VanButton>
      </div>
    </VanDialog>
    <VanDialog v-model:show="dlgB.model.value" title="Dialog B（叠加在 A 之上）" @confirm="dlgB.close()">
      <div data-testid="dlgB-body" style="padding: 24px; text-align: center">我是 B，叠加在 A 上方（两个弹窗同时可见）。</div>
    </VanDialog>

    <!-- 确认弹窗 + await 结果 -->
    <VanDialog v-model:show="confirm.model.value" title="确认操作" show-cancel-button @confirm="confirm.resolve(true)" @cancel="confirm.resolve(false)">
      <div data-testid="dialog-body" style="padding: 24px; text-align: center">确定执行此操作吗？(由 layerman 队列驱动)</div>
    </VanDialog>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.pop-enter-active {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s;
}
.pop-leave-active {
  transition: transform 0.2s ease, opacity 0.2s;
}
.pop-enter-from {
  transform: scale(0.8) translateY(12px);
  opacity: 0;
}
.pop-leave-to {
  transform: scale(0.9);
  opacity: 0;
}
</style>
