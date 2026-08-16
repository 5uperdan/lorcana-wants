/** Bootstrap: hand the app the real browser. Nothing else belongs here. */

import { createApp } from "./app.js";

createApp({ document, fetchImpl: fetch.bind(window), clipboard: navigator.clipboard }).start();
