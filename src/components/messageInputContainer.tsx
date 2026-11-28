import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// necessary because of VAD in MessageInput
const DynamicMessageInput = dynamic(() =>
  import("@/components/messageInput"), {
    ssr: false
  }
);

/**
 * Provides text input, voice input (Web Speech id-ID & Groq Whisper /stt),
 * Stop button, Push-to-Talk, and ready-to-play MC segments.
 */
export const MessageInputContainer = ({
  isChatProcessing,
  isChatSpeaking = false,
}: {
  isChatProcessing: boolean;
  isChatSpeaking?: boolean;
}) => {
  const [userMessage, setUserMessage] = useState("");

  useEffect(() => {
    if (!isChatProcessing) {
      setUserMessage("");
    }
  }, [isChatProcessing]);

  return (
    <DynamicMessageInput
      userMessage={userMessage}
      setUserMessage={setUserMessage}
      isChatProcessing={isChatProcessing}
      isChatSpeaking={isChatSpeaking}
      onChangeUserMessage={(e) => setUserMessage(e.target.value)}
    />
  );
};
