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
  ArrowLeft,
  Clipboard,
  ZoomIn,
  ZoomOut,
  Plus,
  Minus,
  Crop,
  RotateCcw
} from "lucide-react";
import { resizeImageDataUrl } from "../../utils/llmHelpers";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";

interface PhotoCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageSubmit: (dataUrl: string, prompt?: string) => void;
  targetLanguage?: string;
  onToast?: (msg: string) => void;
  modeType?: "vocab" | "reply";
}

function PhotoCaptureModal({
  isOpen,
  onClose,
  onImageSubmit,
  onToast,
}: PhotoCaptureModalProps) {
  useModalBackNavigation(isOpen, onClose);

  const [mode, setMode] = useState<"choose" | "camera" | "preview">("choose");
  const [capturedImage, setCapturedImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [focusNote, setFocusNote] = useState<string>("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(false);
  const [_hasMultipleCameras, setHasMultipleCameras] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Zoom State
  const [zoom, setZoom] = useState<number>(1);
  const [maxHardwareZoom, setMaxHardwareZoom] = useState<number>(5);

  // Cropping State
  const [originalImage, setOriginalImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [isCropping, setIsCropping] = useState<boolean>(false);
  const [crop, setCrop] = useState<{ x: number; y: number; width: number; height: number }>({ x: 15, y: 15, width: 70, height: 70 });
  const [imageAspect, setImageAspect] = useState<number>(1);
  const [activeDrag, setActiveDrag] = useState<"move" | "nw" | "ne" | "se" | "sw" | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; cropX: number; cropY: number; cropW: number; cropH: number } | null>(null);

  // Unified image source handler
  const handleNewImageSource = (dataUrl: string, name: string) => {
    setCapturedImage({ dataUrl, name });
    setOriginalImage({ dataUrl, name });
    setMode("preview");
    setIsCropping(false);
    setCrop({ x: 15, y: 15, width: 70, height: 70 });
  };

  // Load original image dimensions to compute aspect ratio and initial crop
  useEffect(() => {
    if (originalImage) {
      const img = new Image();
      img.onload = () => {
        const aspect = img.naturalWidth / img.naturalHeight;
        setImageAspect(aspect);
        
        let w = 70;
        let h = 70 * aspect;
        
        if (aspect > 1) {
          h = 70;
          w = 70 / aspect;
        } else {
          w = 70;
          h = 70 * aspect;
        }
        
        setCrop({
          x: (100 - w) / 2,
          y: (100 - h) / 2,
          width: w,
          height: h
        });
      };
      img.src = originalImage.dataUrl;
    }
  }, [originalImage]);

  // Dragging / Resizing Effect
  useEffect(() => {
    if (!activeDrag || !dragStartRef.current || !containerRef.current) return;

    const handleDragMove = (e: MouseEvent | TouchEvent) => {
      if (!dragStartRef.current || !containerRef.current) return;

      let clientX = 0;
      let clientY = 0;
      if ("touches" in e) {
        if (e.touches.length === 1) {
          clientX = e.touches[0].clientX;
          clientY = e.touches[0].clientY;
        } else {
          return;
        }
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerW = containerRect.width;
      const containerH = containerRect.height;

      if (containerW === 0 || containerH === 0) return;

      const dx = clientX - dragStartRef.current.mouseX;
      const dy = clientY - dragStartRef.current.mouseY;

      const dPctX = (dx / containerW) * 100;
      const dPctY = (dy / containerH) * 100;

      const startX = dragStartRef.current.cropX;
      const startY = dragStartRef.current.cropY;
      const startW = dragStartRef.current.cropW;
      const startH = dragStartRef.current.cropH;

      let nextX = startX;
      let nextY = startY;
      let nextW = startW;
      let nextH = startH;

      const minW = 15;

      if (activeDrag === "move") {
        nextX = Math.max(0, Math.min(100 - startW, startX + dPctX));
        nextY = Math.max(0, Math.min(100 - startH, startY + dPctY));
      } else if (activeDrag === "se") {
        const maxW = Math.min(100 - startX, (100 - startY) / imageAspect);
        nextW = Math.max(minW, Math.min(maxW, startW + dPctX));
        nextH = nextW * imageAspect;
        nextX = startX;
        nextY = startY;
      } else if (activeDrag === "nw") {
        const fixedX = startX + startW;
        const fixedY = startY + startH;
        const maxW = Math.min(fixedX, fixedY / imageAspect);
        nextW = Math.max(minW, Math.min(maxW, startW - dPctX));
        nextH = nextW * imageAspect;
        nextX = fixedX - nextW;
        nextY = fixedY - nextH;
      } else if (activeDrag === "ne") {
        const fixedX = startX;
        const fixedY = startY + startH;
        const maxW = Math.min(100 - fixedX, fixedY / imageAspect);
        nextW = Math.max(minW, Math.min(maxW, startW + dPctX));
        nextH = nextW * imageAspect;
        nextX = fixedX;
        nextY = fixedY - nextH;
      } else if (activeDrag === "sw") {
        const fixedX = startX + startW;
        const fixedY = startY;
        const maxW = Math.min(fixedX, (100 - fixedY) / imageAspect);
        nextW = Math.max(minW, Math.min(maxW, startW - dPctX));
        nextH = nextW * imageAspect;
        nextX = fixedX - nextW;
        nextY = fixedY;
      }

      setCrop({
        x: nextX,
        y: nextY,
        width: nextW,
        height: nextH,
      });
    };

    const handleDragEnd = () => {
      setActiveDrag(null);
      dragStartRef.current = null;
    };

    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
    window.addEventListener("touchmove", handleDragMove, { passive: false });
    window.addEventListener("touchend", handleDragEnd);

    return () => {
      window.removeEventListener("mousemove", handleDragMove);
      window.removeEventListener("mouseup", handleDragEnd);
      window.removeEventListener("touchmove", handleDragMove);
      window.removeEventListener("touchend", handleDragEnd);
    };
  }, [activeDrag]);

  const handleDragStart = (
    e: React.MouseEvent | React.TouchEvent,
    action: "move" | "nw" | "ne" | "se" | "sw"
  ) => {
    e.preventDefault();
    let clientX = 0;
    let clientY = 0;
    
    if ("touches" in e) {
      if (e.touches.length === 1) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        return; // ignore multi-touch
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    setActiveDrag(action);
    dragStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      cropX: crop.x,
      cropY: crop.y,
      cropW: crop.width,
      cropH: crop.height,
    };
  };

  const handleApplyCrop = () => {
    if (!originalImage || crop.width === 0) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      
      const cropPixelX = (crop.x / 100) * img.naturalWidth;
      const cropPixelY = (crop.y / 100) * img.naturalHeight;
      const cropPixelW = (crop.width / 100) * img.naturalWidth;
      const cropPixelH = (crop.height / 100) * img.naturalHeight;

      const finalPixelSize = Math.round(Math.min(cropPixelW, cropPixelH));

      canvas.width = finalPixelSize;
      canvas.height = finalPixelSize;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(
          img,
          Math.round(cropPixelX),
          Math.round(cropPixelY),
          finalPixelSize,
          finalPixelSize,
          0,
          0,
          finalPixelSize,
          finalPixelSize
        );
        const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.9);
        setCapturedImage(prev => prev ? { ...prev, dataUrl: croppedDataUrl } : null);
        setIsCropping(false);
        onToast?.("📐 Image cropped successfully!");
      }
    };
    img.src = originalImage.dataUrl;
  };

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const focusInputRef = useRef<HTMLInputElement | null>(null);

  // Touch Pinch gesture tracking
  const touchStartDistRef = useRef<number | null>(null);
  const initialZoomRef = useRef<number>(1);

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

  // Apply Hardware Zoom constraint if supported by hardware
  const applyHardwareZoom = (zoomVal: number) => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getVideoTracks()?.[0];
    if (track && typeof track.getCapabilities === "function") {
      try {
        const caps = track.getCapabilities() as any;
        if (caps && caps.zoom) {
          const minZ = caps.zoom.min || 1;
          const maxZ = caps.zoom.max || 10;
          setMaxHardwareZoom(Math.min(maxZ, 8));
          const targetZ = Math.min(Math.max(zoomVal, minZ), maxZ);
          track.applyConstraints({ advanced: [{ zoom: targetZ }] } as any).catch(() => {});
        }
      } catch (e) {
        // Fallback to digital zoom
      }
    }
  };

  const handleSetZoom = (newZoom: number) => {
    const clamped = Math.min(Math.max(1, Math.round(newZoom * 10) / 10), 8);
    setZoom(clamped);
    applyHardwareZoom(clamped);
  };

  // Start webcam / mobile camera stream
  const startCamera = async (facing: "environment" | "user" = facingMode) => {
    setCameraError(null);
    setIsCameraLoading(true);
    setZoom(1);
    stopCameraStream();

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          aspectRatio: { ideal: 1 },
          width: { ideal: 1080 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;
      
      // Query capabilities for zoom
      const track = stream.getVideoTracks()?.[0];
      if (track && typeof track.getCapabilities === "function") {
        const caps = track.getCapabilities() as any;
        if (caps?.zoom) {
          setMaxHardwareZoom(Math.min(caps.zoom.max || 5, 8));
        }
      }

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

  // Pinch-to-zoom touch event handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].pageX - e.touches[1].pageX,
        e.touches[0].pageY - e.touches[1].pageY
      );
      touchStartDistRef.current = dist;
      initialZoomRef.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].pageX - e.touches[1].pageX,
        e.touches[0].pageY - e.touches[1].pageY
      );
      const scale = dist / touchStartDistRef.current;
      handleSetZoom(initialZoomRef.current * scale);
    }
  };

  const handleTouchEnd = () => {
    touchStartDistRef.current = null;
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
      setOriginalImage(null);
      setCameraError(null);
      setModalError(null);
      setZoom(1);
      setIsCropping(false);
    }
  }, [isOpen]);

  // Auto-focus on the focus note textfield when entering preview mode
  useEffect(() => {
    if (isOpen && mode === "preview" && !isCropping) {
      const timer = setTimeout(() => {
        focusInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, mode, isCropping]);

  // Take photo from live stream matching exact viewfinder aspect ratio & zoom crop
  const handleSnapPhoto = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    
    const vWidth = video.videoWidth || 1280;
    const vHeight = video.videoHeight || 720;

    // Get the exact display aspect ratio of the camera viewfinder container (1:1 square)
    const container = video.parentElement;
    let AR_view = 1; // Default 1:1 square aspect ratio
    if (container && container.clientHeight > 0) {
      AR_view = container.clientWidth / container.clientHeight;
    }

    const AR_video = vWidth / vHeight;

    // Calculate base visible crop box on the raw video stream matching CSS object-cover
    let visW = vWidth;
    let visH = vHeight;
    let visX = 0;
    let visY = 0;

    if (AR_video < AR_view) {
      // Video is taller (more portrait) than container -> cropped vertically
      visW = vWidth;
      visH = vWidth / AR_view;
      visX = 0;
      visY = (vHeight - visH) / 2;
    } else {
      // Video is wider (more landscape) than container -> cropped horizontally
      visH = vHeight;
      visW = vHeight * AR_view;
      visX = (vWidth - visW) / 2;
      visY = 0;
    }

    // Apply digital zoom level into the center of the visible viewfinder box
    const zoomLevel = Math.max(1, zoom);
    const finalW = visW / zoomLevel;
    const finalH = visH / zoomLevel;
    const finalX = visX + (visW - finalW) / 2;
    const finalY = visY + (visH - finalH) / 2;

    const canvas = canvasRef.current || document.createElement("canvas");
    // Ensure high quality output with the exact viewfinder aspect ratio
    const outputWidth = Math.min(1600, Math.max(960, Math.round(finalW)));
    const outputHeight = Math.round(outputWidth / AR_view);

    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();

    // Mirror image if using front user camera
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(
      video,
      finalX,
      finalY,
      finalW,
      finalH,
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.restore();

    const rawDataUrl = canvas.toDataURL("image/jpeg", 0.9);

    stopCameraStream();

    try {
      const optimized = await resizeImageDataUrl(rawDataUrl, 1600, 0.85);
      const name = `Camera Photo (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      handleNewImageSource(optimized, name);
    } catch (err) {
      handleNewImageSource(rawDataUrl, "Camera Snapshot");
    }
  };

  // Process selected or taken image file
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, isCameraCapture = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      const errorMsg = "Please select a valid image file (PNG, JPG, WEBP)";
      setModalError(errorMsg);
      onToast?.(`⚠️ ${errorMsg}`);
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
          handleNewImageSource(optimized, name);
        } catch (err) {
          handleNewImageSource(rawDataUrl, file.name || "Photo");
        }
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleConfirmUpload = () => {
    if (capturedImage) {
      onImageSubmit(capturedImage.dataUrl, focusNote.trim() || undefined);
      setFocusNote("");
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
          handleNewImageSource(optimized, file.name || "Dropped Image");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Paste from Clipboard directly via button click
  const handlePasteFromClipboard = async () => {
    try {
      setModalError(null);
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageTypes = item.types.filter(type => type.startsWith("image/"));
        if (imageTypes.length > 0) {
          const blob = await item.getType(imageTypes[0]);
          const reader = new FileReader();
          reader.onload = async () => {
            if (typeof reader.result === "string") {
              const rawDataUrl = reader.result;
              try {
                const optimized = await resizeImageDataUrl(rawDataUrl, 1600, 0.85);
                handleNewImageSource(optimized, "Clipboard Image");
              } catch {
                handleNewImageSource(rawDataUrl, "Clipboard Image");
              }
            }
          };
          reader.readAsDataURL(blob);
          onToast?.("📋 Image pasted from clipboard!");
          return;
        }
      }
      const errorMsg = "No image found in clipboard! Please copy an image or screenshot to your clipboard first, then click Paste.";
      setModalError(errorMsg);
      onToast?.(`⚠️ ${errorMsg}`);
    } catch (err: any) {
      console.warn("Direct clipboard reading permission or support missing:", err);
      const errorMsg = "Could not access clipboard directly due to browser security or iframe constraints. Please try pressing Ctrl+V (or Cmd+V on Mac) anywhere on this screen to paste the image!";
      setModalError(errorMsg);
    }
  };

  // Global Ctrl+V / Cmd+V paste event listener
  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      if (!isOpen) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            setModalError(null);
            const reader = new FileReader();
            reader.onload = async () => {
              if (typeof reader.result === "string") {
                const rawDataUrl = reader.result;
                try {
                  const optimized = await resizeImageDataUrl(rawDataUrl, 1600, 0.85);
                  handleNewImageSource(optimized, "Pasted Clipboard Image");
                } catch {
                  handleNewImageSource(rawDataUrl, "Pasted Image");
                }
              }
            };
            reader.readAsDataURL(blob);
            onToast?.("📋 Image pasted from clipboard!");
            e.preventDefault();
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const zoomPresets = [1, 1.5, 2, 3, 5];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-stone-900/70 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="bg-white border border-stone-200 rounded-2xl shadow-2xl max-w-lg w-full max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col relative"
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
          <div className="p-4 sm:p-5 flex-1 overflow-y-auto min-h-0">
            {/* Modal Error Banner */}
            {modalError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-900 shadow-2xs">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-xs sm:text-sm font-semibold">Clipboard Notice</p>
                  <p className="text-xs text-red-700 mt-1 leading-normal break-words">{modalError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalError(null)}
                  className="p-1 rounded hover:bg-red-100 text-red-500 hover:text-red-700 shrink-0 cursor-pointer"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Mode 1: Choice Screen */}
            {mode === "choose" && (
              <div 
                className="space-y-4"
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Option A: Take a Picture */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!!navigator.mediaDevices?.getUserMedia) {
                        setMode("camera");
                      } else {
                        cameraInputRef.current?.click();
                      }
                    }}
                    className="p-3.5 sm:p-5 rounded-xl sm:rounded-2xl border-2 border-dashed border-stone-300 hover:border-blue-500 bg-stone-50/80 hover:bg-blue-50/50 transition-all text-left flex flex-row sm:flex-col items-center sm:items-start gap-3 sm:gap-3 group cursor-pointer shadow-2xs hover:shadow-md w-full"
                  >
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-600 group-hover:bg-blue-700 text-white flex items-center justify-center shadow-md transition-transform group-hover:scale-105 shrink-0">
                      <Camera className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-stone-900 group-hover:text-blue-950 text-sm sm:text-base">
                        Take a Picture
                      </h4>
                      <p className="text-xs text-stone-500 mt-0.5 leading-snug sm:block hidden">
                        Use camera with live preview & zoom support
                      </p>
                      <p className="text-[11px] text-stone-400 mt-0.5 leading-snug block sm:hidden">
                        Live photo with zoom
                      </p>
                    </div>
                    <span className="shrink-0 sm:mt-auto px-2 py-0.5 sm:px-2.5 sm:py-1 bg-blue-100 group-hover:bg-blue-200 text-blue-900 text-[10px] sm:text-[11px] font-bold rounded-lg transition-colors">
                      📸 Snap
                    </span>
                  </button>

                  {/* Option B: Choose from Gallery */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3.5 sm:p-5 rounded-xl sm:rounded-2xl border-2 border-dashed border-stone-300 hover:border-amber-500 bg-stone-50/80 hover:bg-amber-50/50 transition-all text-left flex flex-row sm:flex-col items-center sm:items-start gap-3 sm:gap-3 group cursor-pointer shadow-2xs hover:shadow-md w-full"
                  >
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-stone-900 group-hover:bg-amber-600 text-amber-400 group-hover:text-white flex items-center justify-center shadow-md transition-transform group-hover:scale-105 shrink-0">
                      <ImageIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-stone-900 group-hover:text-amber-950 text-sm sm:text-base">
                        Upload Image
                      </h4>
                      <p className="text-xs text-stone-500 mt-0.5 leading-snug sm:block hidden">
                        Select an existing picture or screenshot
                      </p>
                      <p className="text-[11px] text-stone-400 mt-0.5 leading-snug block sm:hidden">
                        Choose from gallery
                      </p>
                    </div>
                    <span className="shrink-0 sm:mt-auto px-2 py-0.5 sm:px-2.5 sm:py-1 bg-stone-200 group-hover:bg-amber-200 text-stone-800 group-hover:text-amber-950 text-[10px] sm:text-[11px] font-bold rounded-lg transition-colors">
                      🖼️ Browse
                    </span>
                  </button>

                  {/* Option C: Paste Clipboard */}
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="p-3.5 sm:p-5 rounded-xl sm:rounded-2xl border-2 border-dashed border-stone-300 hover:border-violet-500 bg-stone-50/80 hover:bg-violet-50/50 transition-all text-left flex flex-row sm:flex-col items-center sm:items-start gap-3 sm:gap-3 group cursor-pointer shadow-2xs hover:shadow-md w-full"
                  >
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-violet-600 group-hover:bg-violet-700 text-white flex items-center justify-center shadow-md transition-transform group-hover:scale-105 shrink-0">
                      <Clipboard className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-stone-900 group-hover:text-violet-950 text-sm sm:text-base">
                        Paste Clipboard
                      </h4>
                      <p className="text-xs text-stone-500 mt-0.5 leading-snug sm:block hidden">
                        Instantly paste an image from your clipboard
                      </p>
                      <p className="text-[11px] text-stone-400 mt-0.5 leading-snug block sm:hidden">
                        Paste image from clipboard
                      </p>
                    </div>
                    <span className="shrink-0 sm:mt-auto px-2 py-0.5 sm:px-2.5 sm:py-1 bg-violet-100 group-hover:bg-violet-200 text-violet-900 text-[10px] sm:text-[11px] font-bold rounded-lg transition-colors">
                      📋 Paste
                    </span>
                  </button>
                </div>

                {/* Direct Native System Camera Shortcut */}
                <div className="pt-2 border-t border-stone-100 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-full py-2.5 px-4 bg-stone-100 hover:bg-stone-200/80 text-stone-800 border border-stone-200 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-blue-600" />
                    <span>Open Phone Camera App directly</span>
                  </button>

                  <div className={`hidden sm:block w-full py-3 px-4 border border-dashed rounded-xl text-center transition-colors ${isDragging ? "border-blue-500 bg-blue-50" : "border-stone-200 bg-stone-50/50"}`}>
                    <p className="text-xs text-stone-500 font-medium flex items-center justify-center gap-1.5 flex-wrap">
                      <Upload className="w-3.5 h-3.5 text-stone-400" />
                      <span>Or drag & drop an image file, or press <b>Ctrl+V</b> / <b>Cmd+V</b> to paste</span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Mode 2: Live Camera Viewfinder with Zoom Controls */}
            {mode === "camera" && (
              <div className="flex flex-col items-center space-y-3">
                <div 
                  className="relative w-full max-w-sm aspect-square bg-black rounded-2xl overflow-hidden shadow-inner border border-stone-800 flex items-center justify-center touch-none select-none"
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                >
                  {/* Live video feed with Digital/CSS Zoom Scale */}
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    style={{
                      transform: `scale(${zoom}) ${facingMode === "user" ? "rotateY(180deg)" : ""}`,
                      transformOrigin: "center center",
                      transition: "transform 0.1s ease-out"
                    }}
                    className="w-full h-full object-cover"
                  />

                  {/* Active Zoom Badge */}
                  {zoom > 1 && !isCameraLoading && !cameraError && (
                    <div className="absolute top-3 right-3 px-2.5 py-1 bg-stone-900/80 backdrop-blur-md border border-amber-400/40 text-amber-400 text-xs font-mono font-bold rounded-full shadow-md flex items-center gap-1">
                      <ZoomIn className="w-3.5 h-3.5" />
                      <span>{zoom.toFixed(1)}x</span>
                    </div>
                  )}

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

                  {/* Framing Overlay */}
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

                {/* ZOOM CONTROLS PANEL */}
                {!isCameraLoading && !cameraError && (
                  <div className="w-full max-w-sm bg-stone-100/90 border border-stone-200/90 rounded-xl p-2.5 space-y-2 shadow-2xs">
                    {/* Preset Zoom Pills & +/- buttons */}
                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSetZoom(zoom - 0.5)}
                        disabled={zoom <= 1}
                        className="p-1.5 rounded-lg bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 disabled:opacity-40 transition-all cursor-pointer shrink-0"
                        title="Zoom Out"
                      >
                        <Minus className="w-4 h-4" />
                      </button>

                      <div className="flex items-center justify-center gap-1 flex-1 overflow-x-auto py-0.5">
                        {zoomPresets.map((preset) => {
                          const isActive = Math.abs(zoom - preset) < 0.08;
                          return (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => handleSetZoom(preset)}
                              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all cursor-pointer ${
                                isActive
                                  ? "bg-stone-900 text-amber-400 shadow-xs scale-105"
                                  : "bg-white text-stone-700 hover:bg-stone-200/80 border border-stone-200"
                              }`}
                            >
                              {preset}x
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSetZoom(zoom + 0.5)}
                        disabled={zoom >= 8}
                        className="p-1.5 rounded-lg bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 disabled:opacity-40 transition-all cursor-pointer shrink-0"
                        title="Zoom In"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Smooth Zoom Slider */}
                    <div className="flex items-center gap-2 px-1">
                      <ZoomOut className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                      <input
                        type="range"
                        min="1"
                        max={Math.max(5, maxHardwareZoom)}
                        step="0.1"
                        value={zoom}
                        onChange={(e) => handleSetZoom(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-stone-300 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                      <ZoomIn className="w-3.5 h-3.5 text-stone-600 shrink-0" />
                    </div>
                  </div>
                )}

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
              <div className="space-y-3 flex flex-col items-center">
                {isCropping ? (
                  /* Interactive Cropping View */
                  <div className="space-y-4 w-full flex flex-col items-center">
                    <div 
                      ref={containerRef}
                      className="relative select-none touch-none w-full max-w-sm overflow-hidden bg-stone-900 rounded-2xl shadow-inner border border-stone-200"
                    >
                      <img
                        src={originalImage?.dataUrl}
                        alt="Crop source"
                        className="w-full h-auto block pointer-events-none"
                      />
                      
                      {/* Crop Window overlay */}
                      <div
                        style={{
                          left: `${crop.x}%`,
                          top: `${crop.y}%`,
                          width: `${crop.width}%`,
                          height: `${crop.height}%`,
                          boxShadow: "0 0 0 9999px rgba(28, 25, 23, 0.65)", // warm stone-900 transparent mask
                        }}
                        className="absolute border-2 border-amber-400 cursor-move flex items-center justify-center z-10"
                        onMouseDown={(e) => handleDragStart(e, "move")}
                        onTouchStart={(e) => handleDragStart(e, "move")}
                      >
                        {/* Crop Guide lines (Rule of thirds) */}
                        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                          <div className="border-r border-b border-white border-dashed" />
                          <div className="border-r border-b border-white border-dashed" />
                          <div className="border-b border-white border-dashed" />
                          <div className="border-r border-b border-white border-dashed" />
                          <div className="border-r border-b border-white border-dashed" />
                          <div className="border-b border-white border-dashed" />
                          <div className="border-r border-white border-dashed" />
                          <div className="border-r border-white border-dashed" />
                          <div />
                        </div>

                        {/* Corner handles */}
                        <div
                          className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-amber-500 rounded-full cursor-nwse-resize z-20 active:scale-125 transition-transform"
                          onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, "nw"); }}
                          onTouchStart={(e) => { e.stopPropagation(); handleDragStart(e, "nw"); }}
                        />
                        <div
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-amber-500 rounded-full cursor-nesw-resize z-20 active:scale-125 transition-transform"
                          onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, "ne"); }}
                          onTouchStart={(e) => { e.stopPropagation(); handleDragStart(e, "ne"); }}
                        />
                        <div
                          className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-amber-500 rounded-full cursor-nesw-resize z-20 active:scale-125 transition-transform"
                          onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, "sw"); }}
                          onTouchStart={(e) => { e.stopPropagation(); handleDragStart(e, "sw"); }}
                        />
                        <div
                          className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-amber-500 rounded-full cursor-nwse-resize z-20 active:scale-125 transition-transform"
                          onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, "se"); }}
                          onTouchStart={(e) => { e.stopPropagation(); handleDragStart(e, "se"); }}
                        />
                      </div>
                    </div>

                    <div className="text-center px-4">
                      <p className="text-xs text-stone-500 font-medium">
                        Drag the box to move. Drag corners to adjust the crop region.
                      </p>
                    </div>

                    <div className="flex items-center gap-3 w-full max-w-sm pt-1">
                      <button
                        type="button"
                        onClick={() => setIsCropping(false)}
                        className="flex-1 py-2 px-4 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleApplyCrop}
                        className="flex-1 py-2 px-4 bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-bold rounded-xl shadow-md transition-all hover:scale-102 cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Apply Crop</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Image Preview and Action Toolbar */
                  <div className="space-y-3 w-full flex flex-col items-center">
                    <div className="relative max-w-sm w-full aspect-square rounded-2xl overflow-hidden border border-stone-200 bg-stone-900 shadow-md flex items-center justify-center">
                      <img
                        src={capturedImage.dataUrl}
                        alt="Captured photo preview"
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Crop Toolbar Actions */}
                    <div className="flex items-center gap-2 w-full max-w-sm">
                      <button
                        type="button"
                        onClick={() => setIsCropping(true)}
                        className="flex-1 py-2 px-3 bg-stone-900 hover:bg-stone-800 text-white hover:text-amber-400 text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-stone-800"
                      >
                        <Crop className="w-3.5 h-3.5" />
                        <span>Crop Photo</span>
                      </button>

                      {capturedImage.dataUrl !== originalImage?.dataUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            if (originalImage) {
                              setCapturedImage({ ...originalImage });
                              onToast?.("🔄 Reverted to original image!");
                            }
                          }}
                          className="flex-1 py-2 px-3 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-stone-200"
                          title="Reset to Original"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-stone-600" />
                          <span>Reset Image</span>
                        </button>
                      )}
                    </div>

                    {/* Optional Focus Note Input */}
                    <div className="w-full max-w-sm">
                      <input
                        ref={focusInputRef}
                        type="text"
                        value={focusNote}
                        onChange={(e) => setFocusNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleConfirmUpload();
                          }
                        }}
                        placeholder="Add optional focus note (e.g. 'Focus on food items')..."
                        className="w-full bg-stone-50 hover:bg-stone-100/60 focus:bg-white text-stone-900 border border-stone-200 focus:border-amber-400 rounded-xl px-3.5 py-2 text-xs transition-colors placeholder:text-stone-400 font-medium"
                      />
                    </div>

                    <div className="flex items-center gap-3 w-full max-w-sm pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCapturedImage(null);
                          setOriginalImage(null);
                          setFocusNote("");
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
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span>Upload & Analyze</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default React.memo(PhotoCaptureModal);
