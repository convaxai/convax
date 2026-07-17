import canvasStoryboardAnimation from "../../resources/skill-showcases/canvas-storyboard/animation.mp4?asset"
import canvasStoryboardPoster from "../../resources/skill-showcases/canvas-storyboard/poster.png?asset"
import jianyingEditorAnimation from "../../resources/skill-showcases/jianying-editor/animation.mp4?asset"
import jianyingEditorPoster from "../../resources/skill-showcases/jianying-editor/poster.png?asset"
import directorDeskAnimation from "../../resources/skill-showcases/storyai-3d-director-desk/animation.mp4?asset"
import directorDeskPoster from "../../resources/skill-showcases/storyai-3d-director-desk/poster.png?asset"
import type { DesktopBuiltinSkillPresentation } from "./builtin-skill-catalog"

export const desktopBuiltinSkillPresentations = [
  {
    displayName: "Storyboard Builder",
    id: "canvas-storyboard",
    showcase: {
      animation: {
        altText: "Storyboard Builder turns a creative brief into connected, reviewable shot cards.",
        mimeType: "video/mp4",
        path: canvasStoryboardAnimation,
      },
      poster: {
        altText: "Storyboard Builder workflow preview with connected shot cards.",
        mimeType: "image/png",
        path: canvasStoryboardPoster,
      },
    },
  },
  {
    displayName: "JianYing Editor",
    id: "jianying-editor",
    showcase: {
      animation: {
        altText: "JianYing Editor validates a Canvas selection and imports it once into an explicitly chosen draft.",
        mimeType: "video/mp4",
        path: jianyingEditorAnimation,
      },
      poster: {
        altText: "JianYing Editor Canvas export workflow preview.",
        mimeType: "image/png",
        path: jianyingEditorPoster,
      },
    },
  },
  {
    displayName: "3D Director Desk",
    id: "storyai-3d-director-desk",
    showcase: {
      animation: {
        altText: "3D Director Desk reads a stage, offers blocking guidance, and reviews the user's adjustments.",
        mimeType: "video/mp4",
        path: directorDeskAnimation,
      },
      poster: {
        altText: "3D Director Desk read-only planning and review workflow preview.",
        mimeType: "image/png",
        path: directorDeskPoster,
      },
    },
  },
] as const satisfies readonly DesktopBuiltinSkillPresentation[]
