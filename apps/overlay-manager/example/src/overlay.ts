import { createOverlayManager } from "@codejoo/overlaymanager";

/** 演示用管理器：gap 300ms，肉眼可见"一次一个"又不拖沓。驱动本页 Vue/Vant UI。 */
export const om = createOverlayManager({ gap: 300, debug: true });
