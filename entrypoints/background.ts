import { defineBackground } from "wxt/utils/define-background";

export default defineBackground({
  main(_ctx) {
    console.log("Background service worker loaded");
  },
});
