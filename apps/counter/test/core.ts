// 类型/接线冒烟用例：验证插件 api 挂载后 counter.up / counter.down 可用
import { counter, countup, countdown } from "../src";

counter.use(countup.install());
counter.use(countdown.install());
counter.up(100);
counter.down(5000, document.body);
counter.down.group("g1", { showDays: false });
