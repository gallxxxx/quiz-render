import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");

// Сжатие: чем больше число, тем меньше файл. 23 — визуально не отличается
// от исходника, но файл в разы легче. Для TikTok этого более чем достаточно.
Config.setCrf(23);
