import { createApp } from "vue";
import "vant/lib/index.css";

import { createLayermanPlugin } from "@codejoo/layerman/vue";

import App from "./App.vue";
import { om } from "./overlay";

createApp(App).use(createLayermanPlugin(om)).mount("#app");
