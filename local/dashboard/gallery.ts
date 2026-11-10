import { mountGallery } from "./foundation/gallery";
import { h, render } from "preact";
import { TracesGallery } from "./foundation/traces-gallery";
import "./foundation/tokens.css";
import "./foundation/gallery.css";

const root = document.getElementById("gallery-root");
if (root) {
  const parameters = new URLSearchParams(location.search);
  if (parameters.has("traces")) {
    const theme = parameters.get("theme");
    if (theme === "light" || theme === "dark" || theme === "system") document.documentElement.dataset["theme"] = theme;
    render(h(TracesGallery, {}), root);
  } else mountGallery(root);
}
