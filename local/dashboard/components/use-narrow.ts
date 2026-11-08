import { useEffect, useState } from "preact/hooks";

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width: 1023px)").matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const media = matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}
