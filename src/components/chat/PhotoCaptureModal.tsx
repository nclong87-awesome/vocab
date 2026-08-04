import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Camera, 
  Image as ImageIcon, 
  X, 
  RefreshCw, 
  Check, 
  Sparkles, 
  Upload, 
  AlertCircle, 
  SwitchCamera,
  ArrowLeft
} from "lucide-react";
import { resizeImageDataUrl } from "../../utils/llmHelpers";

interface PhotoCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageSelected: (dataUrl: string, name: string) => void;
  targetLanguage?: string;
}

export default function PhotoCaptureModal({
  isOpen,
  onClose,
  onImageSelected,
  targetLanguage = "English"
}: PhotoCaptureModalProps) {
  const [mode, setMode] = useState<"choose" | "camera" | "preview">("choose");
  const [capturedImage, setCapturedImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(false);
  const [_hasMultipleCameras, setHasMultipleCameras] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Stop camera stream cleanly
  const stopCameraStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  };

  // Check available video devices
  useEffect(() => {
    if (isOpen && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const videoDevices = devices.filter(d => d.kind === "videoinput");
        setHasMultipleCameras(videoDevices.length > 1);
      }).catch(() => {});
    }
  }, [isOpen]);

  // Start webcam / mobile camera stream
  const startCamera = async (facing: "environment" | "user" = facingMode) => {
    setCameraError(null);
    setIsCameraLoading(true);
    stopCameraStream();

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraLoading(false);
    } catch (err: any) {
      console.warn("Camera stream initialization error:", err);
      setIsCameraLoading(false);
      setCameraError(
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Camera permission was denied. You can still take a picture using your device camera app button below."
          : "Unable to access live webcam feed directly. Please use the device camera button below."
      );
    }
  };

  // Switch between front and rear cameras
  const handleSwitchCamera = () => {
    const nextFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextFacing);
    startCamera(nextFacing);
  };

  // Handle mode transitions
  useEffect(() => {
    if (isOpen && mode === "camera") {
      startCamera(facingMode);
    } else {
      stopCameraStream();
    }

    return () => {
      stopCameraStream();
    };
  }, [isOpen, mode]);

  // Clean up when modal closes
  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      setMode("choose");
      setCapturedImage(null);
      setCameraError(null);
    }
  }, [isOpen]);

  // Take photo from live stream
  const handleSnapPhoto = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    
    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror image if using front user camera
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const rawDataUrl = canvas.toDataURL("image/jpeg", 0.9);

    stopCameraStream();

    try {
      const optimized = await resizeImageDataUrl(rawDataUrl, 1600, 0.85);
      const name = `Camera Photo (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      setCapturedImage({ dataUrl: optimized, name });
      setMode("preview");
    } catch (err) {
      setCapturedImage({ dataUrl: rawDataUrl, name: "Camera Snapshot" });
      setMode("preview");
    }
  };

  // Process selected or taken image file
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, isCameraCapture = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select a valid image file (PNG, JPG, WEBP)");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === "string") {
        const rawDataUrl = reader.result;
        try {
          const optimized = await resizeImageDataUrl(rawDataUrl, 1600, 0.85);
          const name = isCameraCapture
            ? `Camera Photo (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
            : file.name || "Uploaded Photo";
          setCapturedImage({ dataUrl: optimized, name });
          setMode("preview");
        } catch (err) {
          setCapturedImage({ dataUrl: rawDataUrl, name: file.name || "Photo" });
          setMode("preview");
        }
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleConfirmUpload = () => {
    if (capturedImage) {
      onImageSelected(capturedImage.dataUrl, capturedImage.name);
      onClose();
    }
  };

  // Drag & Drop
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = async () => {
        if (typeof reader.result === "string") {
          const rawDataUrl = reader.result;
          const optimized = await resizeImageDataUrl(rawDataUrl, 1600, 0.85);
          setCapturedImage({ dataUrl: optimized, name: file.name || "Dropped Image" });
          setMode("preview");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-stone-900/70 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="bg-white border border-stone-200 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col relative"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-stone-200 bg-stone-50/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              {mode !== "choose" && (
                <button
                  type="button"
                  onClick={() => {
                    if (mode === "camera") {
                      stopCameraStream();
                      setMode("choose");
                    } else if (mode === "preview") {
                      setMode("choose");
                    }
                  }}
                  className="p-1.5 rounded-lg hover:bg-stone-200 text-stone-600 transition-colors cursor-pointer mr-0.5"
                  title="Go back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <div className="w-8 h-8 rounded-xl bg-stone-900 text-amber-400 flex items-center justify-center font-bold shadow-2xs shrink-0">
                <Camera className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-stone-950 flex items-center gap-1.5">
                  {mode === "camera" ? "Take a Photo" : mode === "preview" ? "Confirm Photo" : "Upload or Take Image"}
                </h3>
                <p className="text-[11px] text-stone-500 font-medium">
                  {mode === "camera"
                    ? "Point camera at objects, signs, or text to extract vocabulary"
                    : mode === "preview"
                    ? "Ready to attach and analyze with AI Vision"
                    : `Snap a photo or select an image to extract ${targetLanguage} words`}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-stone-200 text-stone-500 hover:text-stone-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleFileChange(e, false)}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => handleFileChange(e, true)}
            className="hidden"
          />

          {/* Hidden Canvas for Live Stream Capture */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Body Content */}
          <div className="p-5 flex-1 flex flex-col justify-center min-h-[300px]">
            {/* Mode 1: Choice Screen */}
            {mode === "choose" && (
              <div 
                className="space-y-4"
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Option A: Take a Picture (Live Camera Modal or Direct Shutter) */}
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.mediaDevices?.getUserMedia) {
                        setMode("camera");
                      } else {
                        // Fallback to native camera input
                        cameraInputRef.current?.click();
                      }
                    }}
                    className="p-5 rounded-2xl border-2 border-dashed border-stone-300 hover:border-blue-500 bg-stone-50/80 hover:bg-blue-50/50 transition-all text-left flex flex-col items-center sm:items-start text-center sm:text-left gap-3 group cursor-pointer shadow-2xs hover:shadow-md"
                  >
                    <div className="w-12 h-12 rounded-xl bg-blue-600 group-hover:bg-blue-700 text-white flex items-center justify-center shadow-md transition-transform group-hover:scale-105">
                      <Camera className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-stone-900 group-hover:text-blue-950 text-sm sm:text-base">
                        Take a Picture
                      </h4>
                      <p className="text-xs text-stone-500 mt-1 leading-snug">
                        Use your camera/webcam to snap a live photo right now
                      </p>
                    </div>
                    <span className="mt-auto px-2.5 py-1 bg-blue-100 group-hover:bg-blue-200 text-blue-900 text-[11px] font-bold rounded-lg transition-colors">
                      📸 Snap Photo
                    </span>
                  </button>

                  {/* Option B: Choose from Gallery / Computer */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-5 rounded-2xl border-2 border-dashed border-stone-300 hover:border-amber-500 bg-stone-50/80 hover:bg-amber-50/50 transition-all text-left flex flex-col items-center sm:items-start text-center sm:text-left gap-3 group cursor-pointer shadow-2xs hover:shadow-md"
                  >
                    <div className="w-12 h-12 rounded-xl bg-stone-900 group-hover:bg-amber-600 text-amber-400 group-hover:text-white flex items-center justify-center shadow-md transition-transform group-hover:scale-105">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-stone-900 group-hover:text-amber-950 text-sm sm:text-base">
                        Upload Image File
                      </h4>
                      <p className="text-xs text-stone-500 mt-1 leading-snug">
                        Select an existing picture or screenshot from device gallery
                      </p>
                    </div>
                    <span className="mt-auto px-2.5 py-1 bg-stone-200 group-hover:bg-amber-200 text-stone-800 group-hover:text-amber-950 text-[11px] font-bold rounded-lg transition-colors">
                      🖼️ Browse Files
                    </span>
                  </button>
                </div>

                {/* Direct Native System Camera Shortcut Button */}
                <div className="pt-2 border-t border-stone-100 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-full py-2.5 px-4 bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-200 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-blue-600" />
                    <span>Open Phone Camera App directly</span>
                  </button>

                  <div className={`w-full py-3 px-4 border border-dashed rounded-xl text-center transition-colors ${isDragging ? "border-blue-500 bg-blue-50" : "border-stone-200 bg-stone-50/50"}`}>
                    <p className="text-xs text-stone-500 font-medium flex items-center justify-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-stone-400" />
                      Or drag and drop an image file here
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Mode 2: Live Camera Viewfinder */}
            {mode === "camera" && (
              <div className="flex flex-col items-center space-y-4">
                <div className="relative w-full max-w-sm aspect-[4/3] bg-black rounded-2xl overflow-hidden shadow-inner border border-stone-800 flex items-center justify-center">
                  {/* Live video feed */}
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className={`w-full h-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
                  />

                  {/* Loading spinner */}
                  {isCameraLoading && (
                    <div className="absolute inset-0 bg-stone-950/80 backdrop-blur-xs flex flex-col items-center justify-center text-white space-y-2">
                      <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
                      <p className="text-xs font-bold">Starting camera feed...</p>
                    </div>
                  )}

                  {/* Camera Error / Fallback */}
                  {cameraError && (
                    <div className="absolute inset-0 bg-stone-900 p-6 flex flex-col items-center justify-center text-center text-white space-y-3 z-20">
                      <AlertCircle className="w-10 h-10 text-amber-400 shrink-0" />
                      <p className="text-xs text-stone-200 leading-relaxed font-medium">
                        {cameraError}
                      </p>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md transition-transform hover:scale-105 cursor-pointer flex items-center gap-2"
                      >
                        <Camera className="w-4 h-4" />
                        <span>Launch Camera App</span>
                      </button>
                    </div>
                  )}

                  {/* Camera Framing Overlay */}
                  {!isCameraLoading && !cameraError && (
                    <div className="absolute inset-0 pointer-events-none border-2 border-white/20 rounded-2xl flex flex-col justify-between p-3">
                      <div className="flex justify-between">
                        <div className="w-4 h-4 border-t-2 border-l-2 border-amber-400" />
                        <div className="w-4 h-4 border-t-2 border-r-2 border-amber-400" />
                      </div>
                      <div className="flex justify-between">
                        <div className="w-4 h-4 border-b-2 border-l-2 border-amber-400" />
                        <div className="w-4 h-4 border-b-2 border-r-2 border-amber-400" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Shutter & Switch Camera Controls */}
                {!cameraError && (
                  <div className="flex items-center justify-center gap-6 pt-1 w-full">
                    {/* Switch Camera Front/Back */}
                    <button
                      type="button"
                      onClick={handleSwitchCamera}
                      disabled={isCameraLoading}
                      className="w-11 h-11 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-700 flex items-center justify-center shadow-xs transition-transform hover:scale-105 cursor-pointer disabled:opacity-50"
                      title="Switch Camera (Front/Rear)"
                    >
                      <SwitchCamera className="w-5 h-5" />
                    </button>

                    {/* Primary Shutter Snap Button */}
                    <button
                      type="button"
                      onClick={handleSnapPhoto}
                      disabled={isCameraLoading}
                      className="w-16 h-16 rounded-full bg-amber-500 hover:bg-amber-400 text-stone-950 flex items-center justify-center shadow-lg border-4 border-white transition-all hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
                      title="Take Snapshot"
                    >
                      <div className="w-6 h-6 rounded-full bg-stone-950" />
                    </button>

                    {/* Direct Camera Input Fallback */}
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="w-11 h-11 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-700 flex items-center justify-center shadow-xs transition-transform hover:scale-105 cursor-pointer"
                      title="Use Native System Camera"
                    >
                      <Camera className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Mode 3: Preview Photo before uploading */}
            {mode === "preview" && capturedImage && (
              <div className="space-y-4 flex flex-col items-center">
                <div className="relative max-w-sm w-full max-h-64 rounded-xl overflow-hidden border border-stone-200 bg-stone-900 shadow-md">
                  <img
                    src={capturedImage.dataUrl}
                    alt="Captured photo preview"
                    className="w-full h-full max-h-64 object-contain mx-auto"
                  />
                </div>

                <div className="w-full bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-950 font-medium flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Gemini Vision will extract and translate key vocabulary items from this image!</span>
                </div>

                <div className="flex items-center gap-3 w-full pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCapturedImage(null);
                      setMode("choose");
                    }}
                    className="flex-1 py-2.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retake / Choose Another</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleConfirmUpload}
                    className="flex-1 py-2.5 px-4 bg-stone-900 hover:bg-stone-800 text-amber-400 text-xs font-bold rounded-xl shadow-md transition-all hover:scale-102 cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4 text-amber-400" />
                    <span>Attach & Upload</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
