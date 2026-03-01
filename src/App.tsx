import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Persona, ContentType, GenerationResult, ScriptAngle, AspectRatio, ScriptSegment } from './types';
import { PERSONAS, CONTENT_TYPES } from './constants';
import { 
  User, 
  Globe, 
  FileText, 
  Send, 
  Loader2, 
  Video, 
  Image as ImageIcon, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  Key,
  Maximize2,
  Layers,
  Camera,
  MessageSquare,
  Volume2,
  Play,
  RefreshCw
} from 'lucide-react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Extend Window interface for AI Studio specific APIs
declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const wrapPCMInWAV = (pcmBase64: string, sampleRate = 24000) => {
  try {
    const pcmData = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    
    // RIFF identifier
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + pcmData.length, true); // chunk size
    view.setUint32(8, 0x57415645, false); // "WAVE"
    
    // fmt subchunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // subchunk1 size
    view.setUint16(20, 1, true); // audio format (PCM = 1)
    view.setUint16(22, 1, true); // number of channels
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    
    // data subchunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, pcmData.length, true); // subchunk2 size
    
    const wavData = new Uint8Array(44 + pcmData.length);
    wavData.set(new Uint8Array(wavHeader), 0);
    wavData.set(pcmData, 44);
    
    const binary = Array.from(wavData).map(b => String.fromCharCode(b)).join('');
    return `data:audio/wav;base64,${btoa(binary)}`;
  } catch (e) {
    console.error("Failed to wrap PCM in WAV:", e);
    return `data:audio/mp3;base64,${pcmBase64}`; // Fallback
  }
};

export default function App() {
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<Persona>(PERSONAS[0]);
  const [selectedContentType, setSelectedContentType] = useState<ContentType>('image_post_with_avatar');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [allPersonas, setAllPersonas] = useState<Persona[]>(PERSONAS);
  const [personaData, setPersonaData] = useState<Record<string, Persona>>({});
  const [isInitializingAvatars, setIsInitializingAvatars] = useState(false);
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const [viewingPersona, setViewingPersona] = useState<Persona | null>(null);
  const [isCreatingCustomPersona, setIsCreatingCustomPersona] = useState(false);
  const [customPersonaForm, setCustomPersonaForm] = useState({
    name: '',
    description: '',
    personality: '',
    avatarPrompt: '',
    voiceProperties: '',
    referenceImages: [] as File[]
  });

  // Video Generation Steps State
  const [videoDuration, setVideoDuration] = useState(15);
  const [generatedScript, setGeneratedScript] = useState('');
  const [scriptSegments, setScriptSegments] = useState<ScriptSegment[]>([]);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [currentStep, setCurrentStep] = useState<'config' | 'script' | 'preview'>('config');
  const [scriptAngle, setScriptAngle] = useState<ScriptAngle>('professional');
  const [refinementInput, setRefinementInput] = useState('');
  const [isRefiningScript, setIsRefiningScript] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);

  useEffect(() => {
    checkApiKey();
    loadAndInitializePersonas();
    
    // Setup WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onopen = () => console.log('Connected to progress socket');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'PROGRESS_UPDATE') {
        setGenerationProgress(data.progress);
      }
    };
    setSocket(ws);
    
    return () => ws.close();
  }, []);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
    };
  }, [videoBlobUrl]);

  const checkApiKey = async () => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(hasKey);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = reader.result?.toString().split(',')[1];
        resolve(base64 || '');
      };
      reader.onerror = error => reject(error);
    });
  };

  const loadAndInitializePersonas = async (retryCount = 0) => {
    setIsInitializingAvatars(true);
    try {
      console.log(`Loading personas from database (attempt ${retryCount + 1})...`);
      const response = await fetch('/api/personas');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const savedPersonas = await response.json();
      console.log(`Found ${savedPersonas.length} saved personas in DB:`);
      savedPersonas.forEach((s: any) => {
        console.log(`  - ${s.name} (${s.id}): hasAvatarData=${!!s.avatarData} (len: ${s.avatarData?.length || 0}), hasVoice=${!!s.voiceSampleUrl} (len: ${s.voiceSampleUrl?.length || 0})`);
      });
      
      const enrichedPersonas: Record<string, Persona> = {};
      const personasToGenerate: Persona[] = [];

      // Combine default personas and saved custom personas
      const allPossiblePersonas = PERSONAS.map(p => {
        const saved = savedPersonas.find((s: any) => s.id === p.id);
        // Merge saved data into default persona, ensuring avatarUrl is set from avatarData if needed
        // avatarData in DB is already a data URL (data:image/png;base64,...)
        return saved ? { ...p, ...saved, avatarUrl: saved.avatarData || saved.avatarUrl } : p;
      });

      savedPersonas.forEach((s: any) => {
        if (!allPossiblePersonas.find(p => p.id === s.id)) {
          // It's a custom persona not in the default list
          allPossiblePersonas.push({ ...s, avatarUrl: s.avatarData || s.avatarUrl });
        }
      });

      allPossiblePersonas.forEach(p => {
        const inState = personaData[p.id];
        
        const hasAvatar = !!(p.avatarUrl || p.avatarData);
        const hasVoice = !!p.voiceSampleUrl;

        // A persona is considered "ready" if it has both an avatar and a voice sample
        if (hasAvatar && hasVoice) {
          enrichedPersonas[p.id] = {
            ...p,
            avatarUrl: p.avatarUrl || p.avatarData
          };
        } else if (inState && inState.avatarUrl && inState.voiceSampleUrl) {
          // Already have it in state from a previous partial generation in this session
          enrichedPersonas[p.id] = inState;
        } else {
          console.log(`Persona ${p.name} needs generation: hasAvatar=${hasAvatar}, hasVoice=${hasVoice}`);
          personasToGenerate.push(p);
        }
      });

      setPersonaData(enrichedPersonas);
      setAllPersonas(allPossiblePersonas);

      if (personasToGenerate.length > 0) {
        console.log(`Need to generate/complete ${personasToGenerate.length} personas:`, personasToGenerate.map(p => p.name).join(", "));
        await generateAndSaveAvatars(personasToGenerate, enrichedPersonas);
      } else {
        console.log("All personas already have saved avatars and voice samples.");
      }
    } catch (err) {
      console.error("Failed to load personas:", err);
      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`Retrying in ${delay}ms...`);
        setTimeout(() => loadAndInitializePersonas(retryCount + 1), delay);
      }
    } finally {
      setIsInitializingAvatars(false);
    }
  };

  const generateAndSaveAvatars = async (personas: Persona[], currentData: Record<string, Persona>, force = false) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const newData = { ...currentData };

    for (const persona of personas) {
      try {
        // Add a delay between personas to avoid hitting rate limits
        if (personas.indexOf(persona) > 0) {
          console.log(`Waiting 5 seconds before starting next persona: ${persona.name}...`);
          await new Promise(r => setTimeout(r, 5000));
        }

        const views = [
          { key: 'avatarData', prompt: persona.avatarPrompt },
          { key: 'avatarFront', prompt: `${persona.avatarPrompt}, front profile view, looking at camera` },
          { key: 'avatarBack', prompt: `${persona.avatarPrompt}, back profile view, looking away from camera` },
          { key: 'avatarSide', prompt: `${persona.avatarPrompt}, side profile view` },
          { key: 'avatarFull', prompt: `${persona.avatarPrompt}, full body shot, standing` },
          { key: 'avatarHead', prompt: `${persona.avatarPrompt}, close-up headshot` }
        ];

        const generatedViews: Record<string, string> = {
          avatarData: (!force && (persona.avatarUrl || persona.avatarData)) || '',
          avatarFront: (!force && persona.avatarFront) || '',
          avatarBack: (!force && persona.avatarBack) || '',
          avatarSide: (!force && persona.avatarSide) || '',
          avatarFull: (!force && persona.avatarFull) || '',
          avatarHead: (!force && persona.avatarHead) || ''
        };
        // Extract raw base64 if it's a data URL
        let firstGeneratedImageBase64: string | null = null;
        if (generatedViews.avatarData) {
          firstGeneratedImageBase64 = generatedViews.avatarData.includes(',') 
            ? generatedViews.avatarData.split(',')[1] 
            : generatedViews.avatarData;
        }
        let voiceSampleUrl = force ? null : persona.voiceSampleUrl;
        let voiceProps = force ? null : persona.voiceProperties;

        // Generate voice sample if missing
        if (!voiceSampleUrl) {
          try {
            // Generate voice properties if missing
            if (!voiceProps) {
              console.log(`Generating voice properties for ${persona.name}...`);
              const generatePropsWithRetry = async (retries = 3, delay = 5000): Promise<any> => {
                try {
                  return await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: `Describe the ideal voice for this persona in 10 words or less. 
                    Name: ${persona.name}
                    Description: ${persona.description}
                    Personality: ${persona.personality}
                    
                    Return only the description, e.g., "Deep, authoritative, calm, professional male voice".`,
                  });
                } catch (err: any) {
                  const errorStr = JSON.stringify(err);
                  if ((errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) && retries > 0) {
                    console.log(`Rate limited for voice props of ${persona.name}. Retrying in ${delay}ms... (${retries} retries left)`);
                    await new Promise(r => setTimeout(r, delay));
                    return generatePropsWithRetry(retries - 1, delay * 1.5);
                  }
                  throw err;
                }
              };
              const propResponse = await generatePropsWithRetry();
              voiceProps = propResponse.text?.trim() || 'Professional and clear';
            }

            const ttsPrompt = `Say cheerfully: Hi, I am ${persona.name}, here to assist you. Voice Style: ${voiceProps}`;
            
            const generateTTSWithRetry = async (retries = 5, delay = 10000): Promise<any> => {
              try {
                return await ai.models.generateContent({
                  model: "gemini-2.5-flash-preview-tts",
                  contents: [{ parts: [{ text: ttsPrompt }] }],
                  config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                      voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: persona.voiceName || 'Zephyr' },
                      },
                    },
                  },
                });
              } catch (err: any) {
                const errorStr = JSON.stringify(err);
                if ((errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) && retries > 0) {
                  console.log(`Rate limited for TTS of ${persona.name}. Retrying in ${delay}ms... (${retries} retries left)`);
                  await new Promise(r => setTimeout(r, delay));
                  return generateTTSWithRetry(retries - 1, delay * 1.5);
                }
                throw err;
              }
            };

            const ttsResponse = await generateTTSWithRetry();
            const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              voiceSampleUrl = wrapPCMInWAV(base64Audio);
              console.log(`Generated voice sample for ${persona.name}`);
            }
          } catch (ttsErr) {
            console.error(`Failed to generate voice sample for ${persona.name}:`, ttsErr);
          }
        }

        // Only generate avatars if missing the main one
        if (!generatedViews.avatarData) {
          console.log(`Generating avatars for ${persona.name}...`);
          const generateWithRetry = async (parts: any[], retries = 5, delay = 5000): Promise<any> => {
            try {
              return await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts },
                config: { imageConfig: { aspectRatio: "1:1" } }
              });
            } catch (err: any) {
              const errorStr = JSON.stringify(err);
              if ((errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) && retries > 0) {
                console.log(`Rate limited for ${persona.name}. Retrying in ${delay}ms... (${retries} retries left)`);
                await new Promise(r => setTimeout(r, delay));
                return generateWithRetry(parts, retries - 1, delay * 1.5);
              }
              throw err;
            }
          };

          for (const view of views) {
            // Significant delay between views to stay within free tier / trial limits
            await new Promise(r => setTimeout(r, 3000));
            
            const realismPrompt = `A photorealistic, high-quality real-life photo of a human. ${view.prompt}. 
            Natural lighting, realistic skin texture, authentic background, no digital art, no 3D render, no cinematic filters. 
            The person should have natural expressions, realistic hair, and look like a real human being in a real-world setting.
            High-resolution photography, 8k, sharp focus.`;

            const parts: any[] = [{ text: realismPrompt }];
            
            // Add reference images as context if they exist (user uploaded)
            if (persona.referenceImages && persona.referenceImages.length > 0) {
              persona.referenceImages.forEach(base64 => {
                parts.push({
                  inlineData: {
                    data: base64,
                    mimeType: 'image/png'
                  }
                });
              });
              parts.push({ text: "Use the provided images as visual reference for the person's appearance. Maintain their facial features, ethnicity, and general look." });
            }

            // Add the first generated image as reference for subsequent views to ensure consistency
            if (firstGeneratedImageBase64 && view.key !== 'avatarData') {
              parts.push({
                inlineData: {
                  data: firstGeneratedImageBase64,
                  mimeType: 'image/png'
                }
              });
              parts.push({ text: "CRITICAL: Use this previously generated image as the primary visual reference for the character's face, hair, and features. The new image MUST look exactly like the same person from a different angle." });
            }

            const response = await generateWithRetry(parts);

            if (response.candidates?.[0]?.content?.parts) {
              for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                  const base64 = part.inlineData.data;
                  generatedViews[view.key] = `data:image/png;base64,${base64}`;
                  
                  // Store the first generated image to use as reference for others
                  if (view.key === 'avatarData') {
                    firstGeneratedImageBase64 = base64;
                  }
                }
              }
            }
          }
        }

        const enriched: Persona = {
          ...persona,
          voiceSampleUrl,
          voiceProperties: voiceProps,
          avatarUrl: generatedViews.avatarData,
          avatarData: generatedViews.avatarData, // Ensure avatarData is set for DB
          avatarFront: generatedViews.avatarFront,
          avatarBack: generatedViews.avatarBack,
          avatarSide: generatedViews.avatarSide,
          avatarFull: generatedViews.avatarFull,
          avatarHead: generatedViews.avatarHead
        };

        // Update state and save if we have at least an avatar (existing or new)
        if (generatedViews.avatarData) {
          newData[persona.id] = enriched;
          
          // Update allPersonas to include the new data
          setAllPersonas(prev => prev.map(p => p.id === persona.id ? enriched : p));

          console.log(`Saving persona ${persona.name} to database...`);
          console.log(`  - avatarData length: ${enriched.avatarData?.length || 0}`);
          console.log(`  - voiceSampleUrl length: ${enriched.voiceSampleUrl?.length || 0}`);
          
          // Save to backend
          const saveResponse = await fetch('/api/personas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(enriched)
          });
          
          if (!saveResponse.ok) {
            console.error(`Failed to save persona ${persona.id} to backend`);
          } else {
            console.log(`Successfully saved persona ${persona.name}`);
          }
          setPersonaData({ ...newData });
        }
      } catch (err) {
        console.error(`Failed to generate/complete persona ${persona.name}:`, err);
      }
    }
  };

  const generateVoiceSample = async (persona: Persona) => {
    if (isGeneratingVoice) return;
    
    setIsGeneratingVoice(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let voiceProps = persona.voiceProperties;
      
      // Generate voice properties if missing
      if (!voiceProps) {
        console.log(`Generating voice properties for ${persona.name}...`);
        const generatePropsWithRetry = async (retries = 3, delay = 5000): Promise<any> => {
          try {
            return await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: `Describe the ideal voice for this persona in 10 words or less. 
              Name: ${persona.name}
              Description: ${persona.description}
              Personality: ${persona.personality}
              
              Return only the description, e.g., "Deep, authoritative, calm, professional male voice".`,
            });
          } catch (err: any) {
            const errorStr = JSON.stringify(err);
            if ((errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) && retries > 0) {
              console.log(`Rate limited for voice props of ${persona.name}. Retrying in ${delay}ms... (${retries} retries left)`);
              await new Promise(r => setTimeout(r, delay));
              return generatePropsWithRetry(retries - 1, delay * 1.5);
            }
            throw err;
          }
        };
        const propResponse = await generatePropsWithRetry();
        voiceProps = propResponse.text?.trim() || 'Professional and clear';
      }

      const prompt = `Say cheerfully: Hi, I am ${persona.name}, here to assist you. Voice Style: ${voiceProps}`;
      
      const generateTTSWithRetry = async (retries = 5, delay = 10000): Promise<any> => {
        try {
          return await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: prompt }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: persona.voiceName || 'Zephyr' },
                },
              },
            },
          });
        } catch (err: any) {
          const errorStr = JSON.stringify(err);
          if ((errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) && retries > 0) {
            console.log(`Rate limited for TTS of ${persona.name}. Retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, delay));
            return generateTTSWithRetry(retries - 1, delay * 1.5);
          }
          throw err;
        }
      };

      const response = await generateTTSWithRetry();

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const url = wrapPCMInWAV(base64Audio);
        
        // Update local state
        const updatedPersona = { ...persona, voiceSampleUrl: url, voiceProperties: voiceProps };
        
        if (viewingPersona?.id === persona.id) {
          setViewingPersona(updatedPersona);
        }
        
        setAllPersonas(prev => prev.map(p => p.id === persona.id ? updatedPersona : p));
        setPersonaData(prev => ({ ...prev, [persona.id]: updatedPersona }));
        
        // Save to backend
        await fetch('/api/personas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedPersona)
        });
      }
    } catch (err) {
      console.error("Failed to generate voice sample:", err);
    } finally {
      setIsGeneratingVoice(false);
    }
  };

  const handleGenerateScript = async (skipStepChange = false): Promise<ScriptSegment[] | null> => {
    if (!topic) {
      setError("Please enter a topic first.");
      return null;
    }
    setIsGeneratingScript(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const numSegments = Math.ceil(videoDuration / 7); // Match Veo's 7-second extension length
      
      let promptText = `Write a ${videoDuration}-second video script for a ${selectedPersona.name} persona.
      Topic: ${topic}
      ${description ? `Concept/Ideas: ${description}. Please follow these ideas closely if provided.` : ''}
      Persona Personality: ${selectedPersona.personality}
      Script Angle: ${scriptAngle}
      
      IMPORTANT: Divide the script into exactly ${numSegments} segments. 
      For each segment, decide if it should be:
      1. "avatar": The persona speaking directly to the camera.
      2. "b-roll": A visual scene illustrating the topic (no persona visible).
      
      For each segment, provide:
      - "text": The dialogue or narration.
      - "type": "avatar" or "b-roll".
      - "visualDescription": A detailed prompt for video generation. 
        For "avatar" segments, describe a specific activity the avatar is doing while talking (e.g., walking, gesturing, sipping coffee, checking a phone) and a creative, realistic camera angle/movement (e.g., tracking shot, low angle, slow zoom, handheld vibe).
        For "b-roll" segments, describe the scene and cinematic camera movement.
      - "cameraPosition": For avatar segments, specify (e.g., "Close-up", "Medium shot", "Low angle", "Tracking shot").
      
      If product images are provided, ensure the "visualDescription" for b-roll segments describes the product accurately based on the images. For "avatar" segments, the persona should be interacting with the product if appropriate.
      
      AESTHETIC GUIDELINES:
      - Use professional lighting terms: "soft studio lighting", "golden hour", "cinematic rim light", "bokeh background".
      - Use high-end camera movements: "macro tracking shot", "slow cinematic pan", "dynamic gimbal movement", "shallow depth of field".
      - Focus on textures and details of the product to make it look premium.
      
      Format the output as a JSON object with a "fullScript" string and a "segments" array of objects.
      Example: { 
        "fullScript": "...", 
        "segments": [
          { "text": "...", "type": "avatar", "visualDescription": "...", "cameraPosition": "..." },
          { "text": "...", "type": "b-roll", "visualDescription": "..." }
        ] 
      }`;

      if (url) promptText += `\nReference Website: ${url}`;
      
      const contents: any = { parts: [{ text: promptText }] };
      
      // Add images to script generation for visual context
      if (files.length > 0) {
        for (const file of files) {
          const base64 = await fileToBase64(file);
          contents.parts.push({
            inlineData: {
              data: base64,
              mimeType: file.type
            }
          });
        }
      }
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const data = JSON.parse(response.text || '{}');
      const segments = data.segments || [];
      setGeneratedScript(data.fullScript || '');
      setScriptSegments(segments);
      if (!skipStepChange) setCurrentStep('script');
      return segments;
    } catch (err: any) {
      setError("Failed to generate script: " + err.message);
      return null;
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleRefineScript = async () => {
    if (!refinementInput || !generatedScript) return;
    setIsRefiningScript(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Here is a video script:
      "${generatedScript}"
      
      Please refine this script based on these instructions: "${refinementInput}".
      Keep the ${videoDuration}-second duration and the ${selectedPersona.name} persona's personality.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      setGeneratedScript(response.text || '');
      setRefinementInput('');
    } catch (err: any) {
      setError("Failed to refine script: " + err.message);
    } finally {
      setIsRefiningScript(false);
    }
  };

  const handleCreateCustomPersona = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = customPersonaForm.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
    
    // Assign a random voice from the available ones
    const voices: Persona['voiceName'][] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
    const voiceName = voices[Math.floor(Math.random() * voices.length)];

    // Convert reference images to base64
    const base64Images = await Promise.all(
      customPersonaForm.referenceImages.map(file => fileToBase64(file))
    );

    let voiceSampleUrl = '';
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Say cheerfully: Hi, I am ${customPersonaForm.name}, here to assist you. ${customPersonaForm.voiceProperties ? `Voice Style: ${customPersonaForm.voiceProperties}` : ''}`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        voiceSampleUrl = `data:audio/mp3;base64,${base64Audio}`;
      }
    } catch (err) {
      console.error("Failed to generate voice sample:", err);
    }

    const newPersona: Persona = {
      id,
      name: customPersonaForm.name,
      description: customPersonaForm.description,
      personality: customPersonaForm.personality,
      avatarPrompt: customPersonaForm.avatarPrompt,
      voiceName,
      voiceProperties: customPersonaForm.voiceProperties,
      voiceSampleUrl,
      referenceImages: base64Images
    };
    
    setIsCreatingCustomPersona(false);
    setAllPersonas(prev => [...prev, newPersona]);
    setPersonaData(prev => ({ ...prev, [id]: newPersona }));
    setSelectedPersona(newPersona);

    // Save initial persona to backend (without avatars yet)
    try {
      await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPersona)
      });
    } catch (err) {
      console.error("Failed to save initial persona:", err);
    }
    
    // Trigger generation for this specific persona
    await generateAndSaveAvatars([newPersona], { ...personaData, [id]: newPersona });
  };

  const handleGenerate = async () => {
    if (!topic) {
      setError("Please enter a topic.");
      return;
    }

    const isVideo = CONTENT_TYPES.find(t => t.id === selectedContentType)?.category === 'video';
    if (isVideo && !hasApiKey) {
      setError("Video generation requires a paid API key. Please select one using the key icon.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Prepare parts for the prompt
      const parts: any[] = [];
      
      // Add topic and persona context
      let promptText = `Generate content for the topic: "${topic}".\n`;
      if (description) promptText += `Additional Context/Ideas: ${description}\n`;
      promptText += `Persona: ${selectedPersona.name} (${selectedPersona.description}).\n`;
      promptText += `Personality traits: ${selectedPersona.personality}\n`;
      promptText += `Visual Appearance: ${selectedPersona.avatarPrompt}\n`;
      promptText += `Content Type: ${selectedContentType}\n\n`;
      
      if (url) {
        promptText += `Reference Website: ${url}\n`;
      }

      parts.push({ text: promptText });

      // Add files if any
      if (files.length > 0) {
        for (const file of files) {
          const base64 = await fileToBase64(file);
          parts.push({
            inlineData: {
              data: base64,
              mimeType: file.type
            }
          });
        }
      }

      if (isVideo) {
        // Video Generation Flow with Extension Loop
        let segments = scriptSegments;
        
        // Ensure we have enough segments for the requested duration
        const expectedSegments = Math.ceil(videoDuration / 7);
        if (segments.length === 0 || (segments.length < expectedSegments && videoDuration > 10)) {
          const generated = await handleGenerateScript(true);
          if (generated) segments = generated;
        }

        if (segments.length === 0) {
          segments = [{ text: generatedScript || topic, type: 'avatar', visualDescription: selectedPersona.avatarPrompt, cameraPosition: 'Medium shot' }];
        }

        let lastVideo: any = null;
        let finalDownloadLink = '';

        console.log(`Starting video generation for ${segments.length} segments...`);

        for (let i = 0; i < segments.length; i++) {
          setCurrentSegmentIndex(i);
          const segment = segments[i];
          const isFirst = i === 0;
          
          // Send progress via socket
          const progress = Math.round(((i) / segments.length) * 100);
          socket?.send(JSON.stringify({ type: 'PROGRESS_UPDATE', progress }));
          setGenerationProgress(progress);

          console.log(`[Segment ${i+1}/${segments.length}] Generating ${segment.type} segment...`);
          console.log(`[Segment ${i+1}/${segments.length}] Prompt: ${segment.text.substring(0, 50)}...`);

          let segmentPrompt = '';
          if (segment.type === 'avatar') {
            segmentPrompt = `A photorealistic, real-life video of ${selectedPersona.name}. 
            Visual Description: ${selectedPersona.avatarPrompt}. 
            Activity & Movement: ${segment.visualDescription}.
            Camera Position: ${segment.cameraPosition || 'Medium shot'}.
            Current Dialogue Segment: ${segment.text}
            Total Duration Target: ${videoDuration} seconds.
            The persona ${selectedPersona.name} is speaking directly to the camera like a real human. 
            Include natural human movements: subtle blinking, realistic eye contact, natural head tilts.
            The tone is ${selectedPersona.personality}. 
            ${selectedPersona.voiceProperties ? `Voice Style: ${selectedPersona.voiceProperties}.` : ''}
            Ensure the character's appearance strictly follows the visual description and looks like a real person. 
            The background should be a real-world professional setting.`;
          } else {
            segmentPrompt = `A photorealistic, high-quality real-life B-roll video. 
            Scene Description: ${segment.visualDescription}. 
            Narrated Text: ${segment.text}
            Style: ${selectedPersona.personality}. 
            Ensure high visual quality, natural lighting, and realistic textures. 
            Include cinematic camera movement (e.g., slow zoom, pan, or Ken Burns effect).`;
          }

          if (!isFirst) {
            segmentPrompt += `\nThis is a continuation of the previous scene. Maintain visual consistency and flow.`;
          }

          let operation;
          try {
            if (isFirst) {
              console.log(`[Segment ${i+1}/${segments.length}] Calling generateVideos with veo-3.1-fast-generate-preview...`);
              
              const videoPayload: any = {
                model: 'veo-3.1-fast-generate-preview',
                prompt: segmentPrompt,
                config: {
                  numberOfVideos: 1,
                  resolution: '720p',
                  aspectRatio: aspectRatio
                }
              };

              // If it's a B-roll and we have images, use the first image as the starting frame
              if (files.length > 0 && segment.type === 'b-roll') {
                const base64 = await fileToBase64(files[0]);
                const base64Data = base64.split(',')[1];
                videoPayload.image = {
                  imageBytes: base64Data,
                  mimeType: files[0].type
                };
                console.log(`[Segment ${i+1}/${segments.length}] Using uploaded product image as starting frame for aesthetic B-roll.`);
              }

              operation = await ai.models.generateVideos(videoPayload);
            } else {
              console.log(`[Segment ${i+1}/${segments.length}] Calling generateVideos with veo-3.1-generate-preview (Extension)...`);
              if (!lastVideo) {
                throw new Error(`[Segment ${i+1}/${segments.length}] lastVideo is null for extension!`);
              }
              console.log(`[Segment ${i+1}/${segments.length}] Extending video: ${lastVideo.uri}`);
              try {
                operation = await ai.models.generateVideos({
                  model: 'veo-3.1-generate-preview',
                  prompt: segmentPrompt,
                  video: lastVideo,
                  config: {
                    numberOfVideos: 1,
                    resolution: '720p',
                    aspectRatio: aspectRatio
                  }
                });
              } catch (extErr: any) {
                console.error(`[Segment ${i+1}/${segments.length}] Extension call failed!`, extErr);
                if (extErr.message) console.error(`Error message: ${extErr.message}`);
                if (extErr.status) console.error(`Error status: ${extErr.status}`);
                throw extErr;
              }
            }

            console.log(`[Segment ${i+1}/${segments.length}] Operation started: ${operation.name}`);

            // Poll for completion
            let pollCount = 0;
            while (!operation.done) {
              pollCount++;
              console.log(`[Segment ${i+1}/${segments.length}] Polling... (Attempt ${pollCount})`);
              await new Promise(resolve => setTimeout(resolve, 10000));
              operation = await ai.operations.getVideosOperation({ operation: operation });
            }

            console.log(`[Segment ${i+1}/${segments.length}] Operation complete!`);
            
            // Add a small delay to ensure the video is fully "processed" and ready for extension
            console.log(`[Segment ${i+1}/${segments.length}] Waiting 10s for backend processing...`);
            await new Promise(resolve => setTimeout(resolve, 10000));

            // Update lastVideo for the next extension
            if (operation.response?.generatedVideos?.[0]?.video) {
              lastVideo = operation.response.generatedVideos[0].video;
              finalDownloadLink = lastVideo.uri;
              console.log(`[Segment ${i+1}/${segments.length}] New video URI: ${finalDownloadLink}`);
            } else {
              console.error(`[Segment ${i+1}/${segments.length}] No video in response!`, operation.response);
              throw new Error("Video generation failed: No video returned from operation.");
            }
          } catch (err: any) {
            console.error(`[Segment ${i+1}/${segments.length}] Error during generation:`, err);
            throw err;
          }
        }

        // Final progress update
        socket?.send(JSON.stringify({ type: 'PROGRESS_UPDATE', progress: 100 }));
        setGenerationProgress(100);

        if (finalDownloadLink) {
          try {
            const response = await fetch(finalDownloadLink, {
              method: 'GET',
              headers: {
                'x-goog-api-key': process.env.GEMINI_API_KEY || '',
              },
            });
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            setVideoBlobUrl(blobUrl);
            setResult({
              type: 'video',
              url: blobUrl,
              text: `Generated ${selectedContentType.replace(/_/g, ' ')} for ${topic}`,
              script: generatedScript,
              scriptSegments: scriptSegments
            });
          } catch (fetchErr) {
            console.error("Failed to fetch video blob:", fetchErr);
            setResult({
              type: 'video',
              url: `${finalDownloadLink}&x-goog-api-key=${process.env.GEMINI_API_KEY}`,
              text: `Generated ${selectedContentType.replace(/_/g, ' ')} for ${topic}`,
              script: generatedScript,
              scriptSegments: scriptSegments
            });
          }
        }
      } else {
        // Image Generation Flow
        const imagePrompt = selectedContentType === 'image_post_with_avatar' 
          ? `A photorealistic, high-quality real-life social media post photo featuring ${selectedPersona.name}. 
             Appearance: ${selectedPersona.avatarPrompt}. 
             The persona is presenting or interacting with the topic: "${topic}". 
             The style should be ${selectedPersona.personality}. 
             Natural lighting, realistic skin texture, authentic real-world environment. 
             No digital art, no 3D render, no cinematic filters.`
          : `A photorealistic, high-quality real-life photo focused on the topic: "${topic}". 
             The style should reflect the ${selectedPersona.name} personality: ${selectedPersona.personality}. 
             Natural lighting, realistic textures, real-world setting.
             No people in the image.`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: imagePrompt }, ...parts.slice(1)] },
          config: {
            imageConfig: { aspectRatio: "16:9" },
            tools: url ? [{ urlContext: {} }] : []
          }
        });

        let imageUrl = '';
        let textContent = '';

        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          } else if (part.text) {
            textContent += part.text;
          }
        }

        setResult({
          type: 'image',
          url: imageUrl,
          text: textContent || `Generated ${selectedContentType.replace(/_/g, ' ')} for ${topic}`
        });
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during generation.");
    } finally {
      setIsGenerating(false);
      setCurrentSegmentIndex(null);
    }
  };

  const handleRegenerateAvatars = async () => {
    setIsInitializingAvatars(true);
    // Use allPersonas instead of just the constants to preserve custom ones and existing metadata
    await generateAndSaveAvatars(allPersonas, personaData, true);
    setIsInitializingAvatars(false);
  };

  const handleRegenerateSinglePersona = async (persona: Persona) => {
    setIsInitializingAvatars(true);
    await generateAndSaveAvatars([persona], personaData, true);
    setIsInitializingAvatars(false);
    // The generateAndSaveAvatars will update personaData state, 
    // but we might need to refresh viewingPersona if it's a separate object
    if (personaData[persona.id]) {
      setViewingPersona(personaData[persona.id]);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] font-sans selection:bg-[#5A5A40] selection:text-white">
      {/* Header */}
      <header className="border-b border-black/10 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2"
          >
            <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center text-white">
              <Sparkles size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">PersonaCraft AI</h1>
              <p className="text-xs text-black/50 font-medium uppercase tracking-wider">Content Studio</p>
            </div>
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-4"
          >
            <button 
              onClick={handleOpenKeySelector}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
                hasApiKey 
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                  : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
              )}
            >
              <Key size={16} />
              {hasApiKey ? "Veo Key Active" : "Connect Veo Key"}
            </button>
          </motion.div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-5 space-y-8">
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/60">
                <span className="text-sm font-bold">01</span>
              </div>
              <div className="flex-1 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Choose Your Persona</h2>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setIsCreatingCustomPersona(true)}
                    className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40] hover:underline"
                  >
                    + Custom Avatar
                  </button>
                  <button 
                    onClick={handleRegenerateAvatars}
                    disabled={isInitializingAvatars}
                    className="text-[10px] font-bold uppercase tracking-widest text-black/30 hover:text-[#5A5A40] transition-colors disabled:opacity-50"
                  >
                    {isInitializingAvatars ? "Generating..." : "Regenerate Avatars"}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {allPersonas.map((persona, idx) => (
                <motion.div
                  key={persona.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  onClick={() => {
                    setSelectedPersona(persona);
                    setViewingPersona(personaData[persona.id] || persona);
                  }}
                  className={cn(
                    "relative group text-left p-4 rounded-2xl border transition-all duration-300 cursor-pointer",
                    selectedPersona.id === persona.id
                      ? "bg-white border-[#5A5A40] shadow-xl shadow-[#5A5A40]/5 scale-[1.02]"
                      : "bg-white/50 border-black/5 hover:border-black/20 hover:bg-white"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-black/5 shrink-0">
                      {personaData[persona.id]?.avatarUrl ? (
                        <img 
                          src={personaData[persona.id].avatarUrl} 
                          alt={persona.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="animate-spin text-black/20" size={20} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm truncate">{persona.name}</h3>
                        {personaData[persona.id]?.avatarUrl && (
                          <span className="text-[8px] font-bold uppercase tracking-tighter px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                            Saved
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-black/50 truncate">{persona.description}</p>
                    </div>
                    
                    {/* Voice Sample Button on Card */}
                    {(personaData[persona.id]?.voiceSampleUrl || persona.voiceSampleUrl) ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const voiceUrl = personaData[persona.id]?.voiceSampleUrl || persona.voiceSampleUrl;
                          if (voiceUrl) {
                            const audio = new Audio(voiceUrl);
                            audio.play().catch(e => console.error("Audio play failed:", e));
                          } else {
                            console.warn("No voice sample URL available for", persona.name);
                          }
                        }}
                        className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/40 hover:bg-[#5A5A40]/10 hover:text-[#5A5A40] transition-all"
                        title="Play Voice Sample"
                      >
                        <Volume2 size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          generateVoiceSample(personaData[persona.id] || persona);
                        }}
                        disabled={isGeneratingVoice}
                        className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/40 hover:bg-[#5A5A40]/10 hover:text-[#5A5A40] transition-all disabled:opacity-50"
                        title="Generate Voice Sample"
                      >
                        {isGeneratingVoice ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      </button>
                    )}
                  </div>
                  {selectedPersona.id === persona.id && (
                    <motion.div 
                      layoutId="selected-check"
                      className="absolute top-2 right-2 text-[#5A5A40]"
                    >
                      <CheckCircle2 size={16} fill="currentColor" className="text-white" />
                    </motion.div>
                  )}
                </motion.div>
              ))}
            </div>
            
            <motion.div 
              key={selectedPersona.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="p-4 rounded-2xl bg-black/5 border border-black/5"
            >
              <p className="text-sm italic text-black/70 leading-relaxed">
                "{selectedPersona.personality}"
              </p>
            </motion.div>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/60">
                <span className="text-sm font-bold">02</span>
              </div>
              <h2 className="text-lg font-semibold">Content Details</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-black/40 px-1">Topic</label>
                <div className="relative">
                  <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30" size={18} />
                  <input
                    type="text"
                    placeholder="What should the content be about?"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full bg-white border border-black/5 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 focus:border-[#5A5A40] transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-black/40 px-1">Description / Ideas</label>
                <div className="relative">
                  <MessageSquare className="absolute left-4 top-4 text-black/30" size={18} />
                  <textarea
                    placeholder="Paste your concept, script ideas, or specific requirements here..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-white border border-black/5 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 focus:border-[#5A5A40] transition-all min-h-[160px] resize-none text-sm leading-relaxed"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-black/40 px-1">Website URL (Optional)</label>
                <div className="relative">
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30" size={18} />
                  <input
                    type="url"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full bg-white border border-black/5 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 focus:border-[#5A5A40] transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-black/40 px-1">Context Files (Optional)</label>
                <div className="relative group">
                  <input
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className="w-full bg-white border border-dashed border-black/20 rounded-2xl py-8 flex flex-col items-center justify-center gap-2 group-hover:border-[#5A5A40] transition-all">
                    <div className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center text-black/40 group-hover:bg-[#5A5A40]/10 group-hover:text-[#5A5A40]">
                      <FileText size={20} />
                    </div>
                    <p className="text-sm font-medium text-black/60">
                      {files.length > 0 ? `${files.length} files selected` : "Drop files or click to upload"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/60">
                <span className="text-sm font-bold">03</span>
              </div>
              <h2 className="text-lg font-semibold">Output Format</h2>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {CONTENT_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setSelectedContentType(type.id as ContentType);
                    setCurrentStep('config');
                  }}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-2xl border transition-all",
                    selectedContentType === type.id
                      ? "bg-white border-[#5A5A40] shadow-lg shadow-[#5A5A40]/5"
                      : "bg-white/50 border-black/5 hover:border-black/20"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center",
                      type.category === 'video' ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"
                    )}>
                      {type.category === 'video' ? <Video size={20} /> : <ImageIcon size={20} />}
                    </div>
                    <div className="text-left">
                      <h3 className="font-bold text-sm">{type.label}</h3>
                      <p className="text-xs text-black/40">{type.description}</p>
                    </div>
                  </div>
                  {selectedContentType === type.id && (
                    <motion.div 
                      layoutId="selected-format"
                      className="w-6 h-6 rounded-full bg-[#5A5A40] flex items-center justify-center text-white"
                    >
                      <CheckCircle2 size={14} />
                    </motion.div>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Video Specific Steps */}
          <AnimatePresence>
            {CONTENT_TYPES.find(t => t.id === selectedContentType)?.category === 'video' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-8 overflow-hidden"
              >
                {/* Step 1: Configuration */}
                <section className="space-y-6 pt-4 border-t border-black/5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Video Configuration</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                        <Maximize2 size={12} /> Aspect Ratio
                      </label>
                      <div className="flex gap-2">
                        {(['9:16', '16:9', '1:1'] as AspectRatio[]).map((ratio) => (
                          <button
                            key={ratio}
                            onClick={() => setAspectRatio(ratio)}
                            className={cn(
                              "flex-1 py-2 text-[10px] font-bold rounded-lg border transition-all",
                              aspectRatio === ratio 
                                ? "bg-[#5A5A40] text-white border-[#5A5A40]" 
                                : "bg-white text-black/40 border-black/5 hover:border-black/20"
                            )}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                        <Layers size={12} /> Duration
                      </label>
                      <div className="flex items-center gap-3">
                        <input 
                          type="range" 
                          min="5" 
                          max="60" 
                          step="5"
                          value={videoDuration}
                          onChange={(e) => setVideoDuration(parseInt(e.target.value))}
                          className="flex-1 h-1.5 bg-black/5 rounded-lg appearance-none cursor-pointer accent-[#5A5A40]"
                        />
                        <span className="text-xs font-bold text-[#5A5A40] w-8">{videoDuration}s</span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Step 2: Script */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Scriptwriting Assistant</h3>
                    {generatedScript && (
                      <div className="flex gap-4">
                        <button 
                          onClick={() => setGeneratedScript('')}
                          className="text-[10px] font-bold text-black/30 uppercase hover:text-red-500 transition-colors"
                        >
                          Reset
                        </button>
                        <button 
                          onClick={() => handleGenerateScript()}
                          className="text-[10px] font-bold text-[#5A5A40] uppercase hover:underline"
                        >
                          Regenerate
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {!generatedScript ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
                        {(['educational', 'storytelling', 'hype', 'professional'] as ScriptAngle[]).map((angle) => (
                          <button
                            key={angle}
                            onClick={() => setScriptAngle(angle)}
                            className={cn(
                              "py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all",
                              scriptAngle === angle 
                                ? "bg-[#5A5A40]/10 text-[#5A5A40] border-[#5A5A40]" 
                                : "bg-white text-black/40 border-black/5 hover:border-black/20"
                            )}
                          >
                            {angle}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => handleGenerateScript()}
                        disabled={isGeneratingScript || !topic}
                        className="w-full py-4 rounded-2xl border border-dashed border-black/20 text-black/40 font-bold text-sm hover:border-[#5A5A40] hover:text-[#5A5A40] transition-all flex items-center justify-center gap-2"
                      >
                        {isGeneratingScript ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                        {isGeneratingScript ? "Drafting Script..." : `Generate ${scriptAngle} Script`}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="max-h-[300px] overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                        {scriptSegments.map((segment, idx) => (
                          <div key={idx} className="p-4 rounded-xl bg-white border border-black/5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className={cn(
                                "text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full",
                                segment.type === 'avatar' ? "bg-indigo-50 text-indigo-600" : "bg-amber-50 text-amber-600"
                              )}>
                                {segment.type}
                              </span>
                              {segment.cameraPosition && (
                                <span className="text-[8px] font-bold text-black/30 uppercase flex items-center gap-1">
                                  <Camera size={10} /> {segment.cameraPosition}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-black/80 leading-relaxed">{segment.text}</p>
                            <div className="text-[9px] text-black/40 italic border-t border-black/5 pt-2 mt-2">
                              Visual: {segment.visualDescription}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          placeholder="Ask AI to refine (e.g., 'make it funnier')"
                          value={refinementInput}
                          onChange={(e) => setRefinementInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleRefineScript()}
                          className="flex-1 bg-black/5 border border-transparent rounded-xl px-4 py-2 text-xs focus:outline-none focus:bg-white focus:border-black/10 transition-all"
                        />
                        <button
                          onClick={handleRefineScript}
                          disabled={isRefiningScript || !refinementInput}
                          className="px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-xs font-bold disabled:opacity-50"
                        >
                          {isRefiningScript ? <Loader2 className="animate-spin" size={14} /> : "Refine"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={handleGenerate}
            disabled={isGenerating || !topic}
            className={cn(
              "w-full py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all",
              isGenerating || !topic
                ? "bg-black/10 text-black/30 cursor-not-allowed"
                : "bg-[#1A1A1A] text-white hover:bg-black shadow-xl shadow-black/10"
            )}
          >
            {isGenerating ? (
              <>
                <Loader2 className="animate-spin" size={24} />
                <span>Crafting Content...</span>
              </>
            ) : (
              <>
                <Send size={24} />
                <span>Generate Content</span>
              </>
            )}
          </motion.button>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-2xl bg-red-50 border border-red-100 flex items-start gap-3 text-red-700"
            >
              <AlertCircle className="shrink-0 mt-0.5" size={18} />
              <p className="text-sm font-medium">{error}</p>
            </motion.div>
          )}
        </div>

        {/* Right Column: Preview/Result */}
        <div className="lg:col-span-7">
          <div className="sticky top-28 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-serif italic">Studio Preview</h2>
              <AnimatePresence>
                {result && (
                  <motion.span 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-widest border border-emerald-100"
                  >
                    Ready
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div className="relative aspect-video rounded-[32px] overflow-hidden bg-white border border-black/5 shadow-2xl shadow-black/5 flex items-center justify-center group">
              <AnimatePresence mode="wait">
                {isGenerating ? (
                  <motion.div 
                    key="generating"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-6 text-center px-12"
                  >
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full border-4 border-black/5 border-t-[#5A5A40] animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Sparkles className="text-[#5A5A40] animate-pulse" size={32} />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-xl font-bold">Generating your masterpiece</h3>
                      <div className="w-full bg-black/5 h-2 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${generationProgress}%` }}
                          className="h-full bg-[#5A5A40]"
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-black/40">
                        <span>Progress</span>
                        <span>{generationProgress}%</span>
                      </div>
                      <p className="text-black/40 text-sm max-w-xs mx-auto">
                        {selectedContentType.includes('video') 
                          ? `Video generation takes a few minutes. ${currentSegmentIndex !== null ? `(Segment ${currentSegmentIndex + 1} of ${scriptSegments.length})` : ''}`
                          : "We're composing the perfect image based on your topic and persona."}
                      </p>
                    </div>
                  </motion.div>
                ) : result ? (
                  <motion.div 
                    key="result"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="w-full h-full"
                  >
                    {result.type === 'video' ? (
                      <video 
                        src={result.url} 
                        controls 
                        autoPlay
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img 
                        src={result.url} 
                        alt="Generated content" 
                        className="w-full h-full object-cover"
                      />
                    )}
                  </motion.div>
                ) : (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center gap-4 text-center px-12"
                  >
                    <div className="w-20 h-20 rounded-full bg-black/5 flex items-center justify-center text-black/20">
                      {selectedContentType.includes('video') ? <Video size={40} /> : <ImageIcon size={40} />}
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold text-black/40">Ready to Create</h3>
                      <p className="text-black/30 text-sm max-w-xs">
                        Configure your persona and topic on the left to start generating content.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence>
              {result?.text && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-3xl p-8 border border-black/5 shadow-xl shadow-black/5 space-y-4"
                >
                  <div className="flex items-center gap-2 text-[#5A5A40]">
                    <FileText size={18} />
                    <h3 className="text-xs font-bold uppercase tracking-widest">Generated Context</h3>
                  </div>
                  <div className="prose prose-sm max-w-none text-black/70 leading-relaxed">
                    <Markdown>{result.text}</Markdown>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!result && !isGenerating && (
              <div className="grid grid-cols-3 gap-4 opacity-40 grayscale">
                {[1, 2, 3].map(i => (
                  <motion.div 
                    key={i} 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.1 }}
                    className="aspect-square rounded-2xl bg-black/5 border border-dashed border-black/10"
                  ></motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-black/5 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2 opacity-50">
          <Sparkles size={16} />
          <span className="text-xs font-bold uppercase tracking-widest">PersonaCraft AI v1.0</span>
        </div>
        <div className="flex items-center gap-8 text-xs font-medium text-black/40">
          <a href="#" className="hover:text-black transition-colors">Documentation</a>
          <a href="#" className="hover:text-black transition-colors">API Reference</a>
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="hover:text-black transition-colors">Billing Info</a>
        </div>
      </footer>
      {/* Create Avatar Modal */}
      <AnimatePresence>
        {isCreatingCustomPersona && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsCreatingCustomPersona(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl p-8 space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-serif italic text-[#1A1A1A]">Create Custom Avatar</h2>
                <button 
                  onClick={() => setIsCreatingCustomPersona(false)}
                  className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center hover:bg-black/10 transition-colors"
                >
                  <span className="text-xl">×</span>
                </button>
              </div>

              <form onSubmit={handleCreateCustomPersona} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/40">Name</label>
                  <input 
                    required
                    type="text"
                    value={customPersonaForm.name}
                    onChange={e => setCustomPersonaForm({...customPersonaForm, name: e.target.value})}
                    className="w-full bg-black/5 border border-transparent rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-black/10 transition-all"
                    placeholder="e.g. Rohan"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/40">Role / Description</label>
                  <input 
                    required
                    type="text"
                    value={customPersonaForm.description}
                    onChange={e => setCustomPersonaForm({...customPersonaForm, description: e.target.value})}
                    className="w-full bg-black/5 border border-transparent rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-black/10 transition-all"
                    placeholder="e.g. The Tech Enthusiast"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/40">Personality</label>
                  <textarea 
                    required
                    value={customPersonaForm.personality}
                    onChange={e => setCustomPersonaForm({...customPersonaForm, personality: e.target.value})}
                    className="w-full bg-black/5 border border-transparent rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-black/10 transition-all h-20 resize-none"
                    placeholder="Describe how they speak and behave..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/40">Voice Properties (Optional)</label>
                  <input 
                    type="text"
                    value={customPersonaForm.voiceProperties}
                    onChange={e => setCustomPersonaForm({...customPersonaForm, voiceProperties: e.target.value})}
                    className="w-full bg-black/5 border border-transparent rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-black/10 transition-all"
                    placeholder="e.g. Cheerful, Indian accent, Hindi/English mix..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/40">Visual Prompt</label>
                  <textarea 
                    required
                    value={customPersonaForm.avatarPrompt}
                    onChange={e => setCustomPersonaForm({...customPersonaForm, avatarPrompt: e.target.value})}
                    className="w-full bg-black/5 border border-transparent rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-black/10 transition-all h-24 resize-none"
                    placeholder="Describe their physical appearance and setting..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-black/40">Reference Images (Optional)</label>
                  <div className="relative group">
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files) {
                          setCustomPersonaForm({
                            ...customPersonaForm,
                            referenceImages: Array.from(e.target.files)
                          });
                        }
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="w-full bg-black/5 border border-dashed border-black/10 rounded-xl py-6 flex flex-col items-center justify-center gap-2 group-hover:border-[#5A5A40] transition-all">
                      <ImageIcon size={20} className="text-black/20" />
                      <p className="text-[10px] font-bold text-black/40 uppercase">
                        {customPersonaForm.referenceImages.length > 0 
                          ? `${customPersonaForm.referenceImages.length} images selected` 
                          : "Upload reference photos"}
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-4 bg-[#5A5A40] text-white rounded-2xl font-bold text-sm hover:bg-black transition-all shadow-lg shadow-[#5A5A40]/20"
                >
                  Generate Avatar Profiles
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persona Detail Modal */}
      <AnimatePresence>
        {viewingPersona && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setViewingPersona(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[32px] shadow-2xl p-8 space-y-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-serif italic text-[#1A1A1A]">{viewingPersona.name}</h2>
                  <p className="text-[#5A5A40] font-medium tracking-wide uppercase text-xs mt-1">{viewingPersona.description}</p>
                </div>
                <button 
                  onClick={() => setViewingPersona(null)}
                  className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center hover:bg-black/10 transition-colors"
                >
                  <span className="text-xl">×</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">Personality</h3>
                    <p className="text-sm leading-relaxed text-black/70 bg-black/5 p-4 rounded-2xl italic">
                      "{viewingPersona.personality}"
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">Visual Prompt</h3>
                    <p className="text-xs leading-relaxed text-black/50 bg-black/5 p-4 rounded-xl">
                      {viewingPersona.avatarPrompt}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-black/40">Reference Profiles</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Front', img: viewingPersona.avatarFront },
                      { label: 'Back', img: viewingPersona.avatarBack },
                      { label: 'Side', img: viewingPersona.avatarSide },
                      { label: 'Full', img: viewingPersona.avatarFull },
                      { label: 'Head', img: viewingPersona.avatarHead },
                    ].map((view, i) => (
                      <div key={i} className="space-y-1">
                        <div className="aspect-square rounded-xl bg-black/5 overflow-hidden border border-black/5">
                          {view.img ? (
                            <img src={view.img} alt={view.label} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Loader2 className="animate-spin text-black/10" size={16} />
                            </div>
                          )}
                        </div>
                        <p className="text-[10px] text-center font-bold text-black/30 uppercase">{view.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-black/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (viewingPersona.voiceSampleUrl) {
                        const audio = new Audio(viewingPersona.voiceSampleUrl);
                        audio.play().catch(e => console.error("Audio play failed:", e));
                      } else {
                        generateVoiceSample(viewingPersona);
                      }
                    }}
                    disabled={isGeneratingVoice}
                    className="flex items-center gap-2 px-6 py-3 bg-black/5 text-black hover:bg-black/10 rounded-full font-bold text-sm transition-all"
                  >
                    {isGeneratingVoice ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : viewingPersona.voiceSampleUrl ? (
                      <Volume2 size={18} />
                    ) : (
                      <Play size={18} />
                    )}
                    {isGeneratingVoice ? 'Generating...' : viewingPersona.voiceSampleUrl ? 'Listen to Voice' : 'Generate Voice'}
                  </button>
                  
                  <button
                    onClick={() => handleRegenerateSinglePersona(viewingPersona)}
                    disabled={isInitializingAvatars}
                    className="flex items-center gap-2 px-6 py-3 bg-black/5 text-black hover:bg-black/10 rounded-full font-bold text-sm transition-all"
                  >
                    <RefreshCw size={18} className={isInitializingAvatars ? "animate-spin" : ""} />
                    Regenerate
                  </button>
                </div>

                <button
                  onClick={() => {
                    setSelectedPersona(viewingPersona);
                    setViewingPersona(null);
                  }}
                  className="px-8 py-3 bg-[#1A1A1A] text-white rounded-full font-bold text-sm hover:bg-black transition-all shadow-lg shadow-black/10"
                >
                  Select this Persona
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
