import {createElement as h} from "react";
import { render } from "../react-mount";
import { TracesGallery } from "../../../local/dashboard/foundation/traces-gallery";

const parameters = new URLSearchParams(location.search);
const root = document.getElementById("gallery-root");
if (root && parameters.has("traces")) {
  const theme = parameters.get("theme");
  if (theme === "light" || theme === "dark" || theme === "system")
    document.documentElement.dataset["theme"] = theme;
  render(h(TracesGallery, {}), root);
}
