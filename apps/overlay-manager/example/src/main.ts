import { createApp } from "vue";
import "vant/lib/index.css";

import { createOverlayManagerPlugin } from "@codejoo/overlaymanager/vue";

import App from "./App.vue";
import { om } from "./overlay";

createApp(App).use(createOverlayManagerPlugin(om)).mount("#app");
