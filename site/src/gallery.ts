import "../../local/dashboard/foundation/tokens.css";
import "../../local/dashboard/foundation/gallery.css";
import "./style.css";
import "./account.css";
import "./dashboard/dashboard.css";
import "./ui/ui.css";
import "./skills/skills.css";
import "./hosted.css";
import "./skills/hosted-skills.css";
import { mountGallery } from "../../local/dashboard/foundation/gallery";

const root = document.getElementById("gallery-root");
const native = document.getElementById("hosted-native-gallery");
const parameters = new URLSearchParams(location.search);
if (parameters.has("hostedNative") && root && native) {
  root.hidden = true;
  native.hidden = false;
} else if (root && !parameters.has("traces")) mountGallery(root);
