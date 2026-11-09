import "../../local/dashboard/foundation/tokens.css";
import "../../local/dashboard/foundation/gallery.css";
import { mountGallery } from "../../local/dashboard/foundation/gallery";

const root = document.getElementById("gallery-root");
if (root) mountGallery(root);
