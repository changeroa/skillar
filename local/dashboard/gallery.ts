import { mountGallery } from "./foundation/gallery";
import "./foundation/tokens.css";
import "./foundation/gallery.css";

const root = document.getElementById("gallery-root");
if (root) mountGallery(root);
