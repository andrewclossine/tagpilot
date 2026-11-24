import type { Key, T } from "@/lib/i18n";
import { QR_FIELDS, QR_TYPES } from "@/lib/qr";
import type { QrLabels } from "./QrBuilder";

/** The words of the QR builder. */
export function qrLabels(t: T): QrLabels {
  const fields = [...new Set(Object.values(QR_FIELDS).flat())];
  return {
    types: Object.fromEntries(QR_TYPES.map((x) => [x, t(`qr_t_${x}` as Key)])),
    fields: Object.fromEntries(fields.map((x) => [x, t(`qr_f_${x}` as Key)])),
    name: t("qr_name"), content: t("qr_content"), design: t("qr_design"), dynamic: t("qr_dynamic"), dynamic_help: t("qr_dynamic_help"), static_help: t("qr_static_help"),
    static_locked: t("qr_static_locked"), colors: t("qr_colors"), fg: t("qr_fg"), bg: t("qr_bg"), eye_color: t("qr_eye_color"), dots: t("qr_dots"), eyes: t("qr_eyes"),
    logo: t("qr_logo"), logo_help: t("qr_logo_help"), remove: t("remove"), frame: t("qr_frame"), frame_text: t("qr_frame_text"), frame_color: t("qr_frame_color"), ecc: t("qr_ecc"),
    save: t("save"), download_png: t("qr_download_png"), download_svg: t("qr_download_svg"), preview: t("qr_preview"), file: t("qr_file"), file_help: t("qr_file_help"),
    file_current: t("qr_file_current"), security: t("qr_f_security"), hidden: t("qr_f_hidden"), empty: t("qr_empty_preview"),
    shapes: { square: t("qr_s_square"), rounded: t("qr_s_rounded"), dots: t("qr_s_dots"), circle: t("qr_s_circle") },
    frames: { none: t("qr_fr_none"), box: t("qr_fr_box"), banner: t("qr_fr_banner") },
  };
}

/** The short link a dynamic code holds. */
export const shortLinkOf = (slug: string) => `${(process.env.APP_URL || "").replace(/\/$/, "")}/q/${slug}`;
