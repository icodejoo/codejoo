import type { IDefaults } from "./types";

const defauls: IDefaults = {
  timeOffset: 0,
  countdown: {
    formatter: 1,
    parser: 1,
  },
  countup: {
    formatter: 1,
    parser: 1,
  },
};

const task: any[] = [];
let rafId: number | null = null;

function req() {
  if (rafId === null) {
    for (const t of task) {
    }
    rafId = requestAnimationFrame(req);
  } else {
    console.log("timer is running");
  }
}

function stop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function countdown(dateTime: any, label?: string) {
  if (task.length) {
  }
}

function countup(to: number | string, ease: Ease) {}

export const Timer = { defauls, countdown, countup };

export default Timer;
