import { createContext } from "react";
import { VideoAvatarController } from "./videoAvatarController";

export const videoAvatarController = new VideoAvatarController();

export const VideoAvatarContext = createContext({
  videoAvatar: videoAvatarController,
});
