import { counter, countup, countdown } from "../src";

counter.use(countup.install());
counter.use(countdown.install());
counter.up(100);
counter.down();
counter.down.group('')
