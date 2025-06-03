const { useState, useEffect, useSyncExternalStore, useCallback, useMemo, useRef } = React;

const room = new WebsimSocket();

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 32;
const EFFECT_SIZE = 64; // Effects are a bit larger
const EFFECT_DURATION_MS = 5000; // 5 seconds
const PLAYER_SPEED = 2; // Player speed reduced

// New constants for chunk system
const CHUNK_PIXEL_SIZE = 256; // Each chunk is 256x256 pixels
const TILE_SIZE = 64; // Each tile is 64x64 pixels
const LOAD_RADIUS = 1; // Load chunks in a (LOAD_RADIUS*2+1) x (LOAD_RADIUS*2+1) grid around the player

// URLs for placeholder images
const CHUNK_LOADING_PLACEHOLDER_URL = 'asset_name.png'; // Tileable loading mist (64x64)
const CHUNK_ERROR_PLACEHOLDER_URL = '/error_placeholder.png'; // Error symbol (can be scaled)
const EFFECT_ERROR_PLACEHOLDER_URL = '/error_placeholder.png';

// Thresholds for triggering LLM-driven power evolution
const EVOLUTION_THRESHOLDS = [3, 7, 12, 20];

function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [playerPower, setPlayerPower] = useState(null);
    // Player position is now world coordinates
    const [playerPosition, setPlayerPosition] = useState(() => {
        const savedPos = localStorage.getItem('playerPosition');
        return savedPos ? JSON.parse(savedPos) : { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }; // Default to center of initial view for better feel
    });
    const [playerImage, setPlayerImage] = useState(null);
    // Canvas effects positions are world coordinates
    const [canvasEffects, setCanvasEffects] = useState([]); // { id, url, x (world), y (world), createdAt, imgObj, isLoading, isError }
    const [loadingStates, setLoadingStates] = useState({});
    const [evolutionInProgress, setEvolutionInProgress] = useState(false);

    useEffect(() => {
        websim.getCurrentUser().then(user => {
            setCurrentUser(user);
            if (user) {
                const img = new Image();
                img.onload = () => setPlayerImage(img);
                img.onerror = () => console.error("Failed to load player avatar");
                img.src = `https://images.websim.com/avatar/${user.username}`;
            }
        });
    }, []);
    
    // Persist player's world position
    useEffect(() => {
        localStorage.setItem('playerPosition', JSON.stringify(playerPosition));
    }, [playerPosition]);

    useEffect(() => {
        const savedPower = localStorage.getItem('playerPower');
        if (savedPower) {
            setPlayerPower(JSON.parse(savedPower));
        } else {
            const randomPowerTemplate = ALL_SUPERPOWERS[Math.floor(Math.random() * ALL_SUPERPOWERS.length)];
            const initialPower = {
                id: randomPowerTemplate.id,
                name: randomPowerTemplate.name,
                description: randomPowerTemplate.description,
                currentElements: randomPowerTemplate.baseElements.map(el => ({ ...el, instanceId: Date.now() + Math.random().toString(36) })),
                potentialEvolutions: randomPowerTemplate.potentialEvolutions, // Kept for template info, not direct use
                interactionCount: 0,
            };
            setPlayerPower(initialPower);
            localStorage.setItem('playerPower', JSON.stringify(initialPower));
        }
    }, []);

    const addEffectToCanvas = useCallback((url, worldPosition, elementInstanceId = null, isError = false) => {
        const img = new Image();
        const effectId = Date.now().toString() + Math.random();

        img.onload = () => {
            setCanvasEffects(prevEffects => prevEffects.map(ef =>
                ef.id === effectId ? { ...ef, imgObj: img, isLoading: false, width: img.width, height: img.height } : ef
            ));
        };
        img.onerror = () => {
            console.error(`Failed to load image: ${url}`);
            setCanvasEffects(prevEffects => prevEffects.map(ef => 
                 ef.id === effectId ? { ...ef, isLoading: false, isError: true, url: EFFECT_ERROR_PLACEHOLDER_URL, imgObj: null } : ef
            ).map(ef => {
                 if(ef.id === effectId && ef.isError && !ef.imgObj) {
                    const errorImg = new Image();
                    errorImg.onload = () => setCanvasEffects(prevs => prevs.map(e => e.id === effectId ? {...e, imgObj: errorImg, width: EFFECT_SIZE, height: EFFECT_SIZE} : e));
                    errorImg.src = EFFECT_ERROR_PLACEHOLDER_URL;
                    return {...ef, imgObj: null, isLoading: true}; 
                 }
                 return ef;
            }));
        };
        img.src = isError ? EFFECT_ERROR_PLACEHOLDER_URL : url;

        setCanvasEffects(prev => [...prev, {
            id: effectId,
            url: isError ? EFFECT_ERROR_PLACEHOLDER_URL : url,
            x: worldPosition.x - EFFECT_SIZE / 2, // world coordinates, centered
            y: worldPosition.y - EFFECT_SIZE / 2,
            createdAt: Date.now(),
            imgObj: null,
            isLoading: true,
            isError: isError,
            elementInstanceId: elementInstanceId,
            width: EFFECT_SIZE, 
            height: EFFECT_SIZE,
        }]);
    }, []);
    
    useEffect(() => {
        const timer = setInterval(() => {
            setCanvasEffects(prevEffects =>
                prevEffects.filter(ef => {
                    if (ef.isLoading && !ef.isError) return true;
                    if (ef.isError && ef.isLoading) return true;
                    return Date.now() - ef.createdAt < EFFECT_DURATION_MS;
                })
            );
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const triggerLlmEvolutionCheck = useCallback(async (powerState) => {
        if (evolutionInProgress) return;
        setEvolutionInProgress(true);
        console.log("Attempting LLM-driven power evolution...");

        try {
            let interactionHistorySummary = "Recent interactions for current power elements:\n";
            if (powerState.currentElements.length > 0) {
                for (const el of powerState.currentElements) {
                    const interactions = room.collection(el.datapoint.type).getList();
                    interactionHistorySummary += `- Element "${el.name}" (Type: ${el.datapoint.type}): Used ${interactions.length} times.`;
                    if (interactions.length > 0 && interactions[0].message) {
                         interactionHistorySummary += ` Last recorded action: "${interactions[0].message.substring(0,100)}"`;
                    }
                    interactionHistorySummary += "\n";
                }
            } else {
                 interactionHistorySummary = "No specific element interactions recorded yet for current power set.";
            }


            const systemMessage = `You are a game master designing creative power evolutions for a 2D pixel art exploration game.
Based on the player's current power and their interaction history, suggest a new, unique power element (which will become an activatable button).
The new element should be thematically consistent with the existing power but offer a new type of interaction or effect.
Avoid suggesting elements that are too similar to existing ones. The player already has these elements: ${powerState.currentElements.map(e => e.name).join(', ')}.
Respond ONLY with a JSON object matching this schema:
{
  "newElementName": "string", // A cool, descriptive name for the new ability
  "newDatapointType": "string", // A new, unique websim collection type, ending with '_v1', e.g., "reality_flux_v1", "aetheric_resonance_v1"
  "newDatapointDescription": "string", // What this datapoint represents or does
  "newInteractionPrompt": "string", // Text for the button, e.g., "Induce Flux", "Resonate Aether"
  "newVisualEffectPrompt": "string", // Detailed prompt for DALL-E: "Pixel art of [description], 1:1 aspect ratio, on a transparent background"
  "newVisualEffectTrigger": "on_interaction" // For now, always use "on_interaction"
}`;

            const userMessageContent = `Player's Current Power:
Name: ${powerState.name}
Description: ${powerState.description}
Current Elements (name: button_prompt (datapoint_type)):
${powerState.currentElements.map(el => `- ${el.name}: "${el.datapoint.interactionPrompt}" (${el.datapoint.type})`).join('\n')}

Interaction History Summary:
${interactionHistorySummary}

Suggest a new power element. Ensure newDatapointType is unique, ends with '_v1', and newVisualEffectPrompt specifies pixel art and transparent background.`;

            const completion = await websim.chat.completions.create({
                messages: [
                    { role: "system", content: systemMessage },
                    { role: "user", content: userMessageContent }
                ],
                json: true,
            });

            const evolutionSuggestion = JSON.parse(completion.content);

            // Validate the suggestion (basic)
            if (!evolutionSuggestion.newElementName || !evolutionSuggestion.newDatapointType || !evolutionSuggestion.newDatapointType.endsWith('_v1') || !evolutionSuggestion.newInteractionPrompt || !evolutionSuggestion.newVisualEffectPrompt) {
                throw new Error("LLM suggestion is missing required fields or has invalid format.");
            }
            
            const newElement = {
                id: evolutionSuggestion.newDatapointType.replace(/_v\d+$/, '') + '_element', // Base ID from datapoint type
                instanceId: Date.now() + Math.random().toString(36),
                name: evolutionSuggestion.newElementName,
                datapoint: {
                    type: evolutionSuggestion.newDatapointType,
                    description: evolutionSuggestion.newDatapointDescription,
                    interactionPrompt: evolutionSuggestion.newInteractionPrompt,
                },
                visualEffect: {
                    prompt: evolutionSuggestion.newVisualEffectPrompt,
                    trigger: "on_interaction", // Hardcode for now as per instructions
                },
            };

            setPlayerPower(prevPower => {
                const updatedPower = {
                    ...prevPower,
                    currentElements: [...prevPower.currentElements, newElement],
                };
                localStorage.setItem('playerPower', JSON.stringify(updatedPower));
                alert(`Your power adapts! You gained a new ability: ${newElement.name} - "${newElement.datapoint.interactionPrompt}"`);
                return updatedPower;
            });

        } catch (error) {
            console.error("Error during LLM-driven evolution:", error);
            alert("An attempt to adapt your power encountered an issue. The void whispers... but says nothing useful yet. Try interacting more.");
        } finally {
            setEvolutionInProgress(false);
        }
    }, [evolutionInProgress]); // Removed playerPower from dependencies to avoid stale closures if not careful, pass powerState directly

    const handleInteraction = useCallback(async (element) => {
        if (!currentUser || !playerPower || evolutionInProgress) return;

        setLoadingStates(prev => ({ ...prev, [element.instanceId]: true }));

        try {
            await room.collection(element.datapoint.type).create({
                powerId: playerPower.id,
                elementId: element.id,
                interactionType: element.datapoint.interactionPrompt,
                timestamp: new Date().toISOString(),
                message: `${currentUser.username} used ${element.name} (${playerPower.name}) at world coords ${Math.round(playerPosition.x)},${Math.round(playerPosition.y)}`
            });

            if (element.visualEffect.trigger === 'on_interaction') {
                const imageResult = await websim.imageGen({ prompt: element.visualEffect.prompt, aspect_ratio: "1:1", transparent: true });
                addEffectToCanvas(imageResult.url, playerPosition, element.instanceId); // playerPosition is world coords
            }
            
            // Update interaction count and potentially trigger evolution
            setPlayerPower(prevPower => {
                const newInteractionCount = (prevPower.interactionCount || 0) + 1;
                const updatedPower = { ...prevPower, interactionCount: newInteractionCount };
                localStorage.setItem('playerPower', JSON.stringify(updatedPower));

                if (EVOLUTION_THRESHOLDS.includes(newInteractionCount)) {
                    // Call with a slight delay to ensure state update completes if needed,
                    // and to not block the current interaction flow too much.
                    setTimeout(() => triggerLlmEvolutionCheck(updatedPower), 0);
                }
                return updatedPower;
            });

        } catch (error) {
            console.error("Error during interaction:", error);
            addEffectToCanvas(EFFECT_ERROR_PLACEHOLDER_URL, playerPosition, element.instanceId, true); // playerPosition is world coords
        } finally {
            setLoadingStates(prev => ({ ...prev, [element.instanceId]: false }));
        }
    }, [currentUser, playerPower, playerPosition, addEffectToCanvas, evolutionInProgress, triggerLlmEvolutionCheck]);

    // Subscriptions for 'on_data_change' effects
    playerPower?.currentElements.forEach(element => {
        if (element.visualEffect.trigger === 'on_data_change') {
            // eslint-disable-next-line react-hooks/rules-of-hooks
            const dataList = useSyncExternalStore(
                // eslint-disable-next-line react-hooks/exhaustive-deps
                useMemo(() => room.collection(element.datapoint.type).subscribe, [element.datapoint.type]),
                // eslint-disable-next-line react-hooks/exhaustive-deps
                useMemo(() => room.collection(element.datapoint.type).getList, [element.datapoint.type])
            );
            // eslint-disable-next-line react-hooks/rules-of-hooks
            const lastProcessedCount = useRef(0);

            // eslint-disable-next-line react-hooks/rules-of-hooks
            useEffect(() => {
                if (dataList.length > lastProcessedCount.current && !loadingStates[element.instanceId] && !evolutionInProgress) {
                    lastProcessedCount.current = dataList.length;
                    const generateEffect = async () => {
                        setLoadingStates(prev => ({ ...prev, [element.instanceId]: true }));
                        try {
                            const imageResult = await websim.imageGen({ prompt: element.visualEffect.prompt, aspect_ratio: "1:1", transparent: true });
                            addEffectToCanvas(imageResult.url, playerPosition, element.instanceId); 
                        } catch (error) {
                            console.error("Error generating visual effect on data change:", error);
                            addEffectToCanvas(EFFECT_ERROR_PLACEHOLDER_URL, playerPosition, element.instanceId, true);
                        } finally {
                            setLoadingStates(prev => ({ ...prev, [element.instanceId]: false }));
                        }
                    };
                    generateEffect();
                }
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [dataList, element.instanceId, element.visualEffect.prompt, addEffectToCanvas, playerPosition, evolutionInProgress]);
        }
    });
    
    const handlePlayerMove = useCallback((newWorldPosition) => {
        setPlayerPosition(newWorldPosition);
    }, []);

    if (!playerPower || !currentUser || !playerImage) {
        return <div className="loading-text">Initializing Pixel PowerVerse Explorer...</div>;
    }
    
    const currentPowerTemplate = ALL_SUPERPOWERS.find(p => p.id === playerPower.id);

    return (
        <div className="game-world">
            <GameCanvas
                playerImage={playerImage}
                playerPosition={playerPosition} // world coordinates
                onPlayerMove={handlePlayerMove} // expects world coordinates
                effects={canvasEffects} // effects have world coordinates
            />
            <HudOverlay
                currentUser={currentUser}
                playerPower={playerPower}
                currentPowerTemplate={currentPowerTemplate}
                handleInteraction={handleInteraction}
                loadingStates={loadingStates}
                evolutionInProgress={evolutionInProgress}
            />
        </div>
    );
}

function GameCanvas({ playerImage, playerPosition, onPlayerMove, effects }) {
    const canvasRef = useRef(null);
    const keysPressed = useRef({});
    const [loadedChunks, setLoadedChunks] = useState({}); // { "cx_cy": { imgObj, worldX, worldY, isLoading, isError, id, isTile } }
    const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });

    // Preload placeholder images
    const chunkLoadingPlaceholderImg = useMemo(() => {
        const img = new Image();
        img.src = CHUNK_LOADING_PLACEHOLDER_URL; // This is a 64x64 tileable asset
        return img;
    }, []);
    const chunkErrorPlaceholderImg = useMemo(() => {
        const img = new Image();
        img.src = CHUNK_ERROR_PLACEHOLDER_URL;
        return img;
    }, []);


    useEffect(() => {
        const handleKeyDown = (e) => { keysPressed.current[e.key.toLowerCase()] = true; };
        const handleKeyUp = (e) => { keysPressed.current[e.key.toLowerCase()] = false; };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    const generateAndLoadChunk = useCallback(async (cx, cy) => {
        const chunkId = `chunk_${cx}_${cy}`;
        if (loadedChunks[chunkId] && (loadedChunks[chunkId].imgObj || loadedChunks[chunkId].isLoading)) {
            return; // Already loaded or loading
        }

        // Set initial loading state with tileable loading placeholder
        setLoadedChunks(prev => ({
            ...prev,
            [chunkId]: {
                id: chunkId,
                worldX: cx * CHUNK_PIXEL_SIZE,
                worldY: cy * CHUNK_PIXEL_SIZE,
                imgObj: chunkLoadingPlaceholderImg.complete && chunkLoadingPlaceholderImg.naturalHeight !== 0 ? chunkLoadingPlaceholderImg : null,
                isLoading: true,
                isError: false,
                isTile: true // The loading placeholder is a tile
            }
        }));

        try {
            const seed = Math.abs(cx * 31 + cy * 17); 
            let terrainFeature = "grassy plains";
            if (seed % 10 < 2) terrainFeature = "light forest with occasional clearings";
            else if (seed % 10 < 4) terrainFeature = "patchy desert with hardy shrubs";
            else if (seed % 10 < 5) terrainFeature = "a network of small glowing streams";
            else if (seed % 10 < 6) terrainFeature = "rolling hills with sparse trees";
            else if (seed % 10 < 7) terrainFeature = "fields of strange, glowing flora";
            else terrainFeature = "cracked earth with sparse vegetation";
            
            const prompt = `Pixel art ${TILE_SIZE}x${TILE_SIZE} seamless tile texture for chunk coordinates (${cx}, ${cy}). Style: Vibrant 16-bit fantasy RPG world. Features: ${terrainFeature}.`;
            
            const result = await websim.imageGen({ prompt, width: TILE_SIZE, height: TILE_SIZE });
            const img = new Image();
            img.onload = () => {
                setLoadedChunks(prev => ({
                    ...prev,
                    [chunkId]: { ...prev[chunkId], imgObj: img, isLoading: false, isTile: true } // Generated terrain is a tile
                }));
            };
            img.onerror = () => {
                 console.error(`Failed to load chunk image for ${chunkId} from URL: ${result.url}`);
                 setLoadedChunks(prev => ({
                    ...prev,
                    [chunkId]: { ...prev[chunkId], imgObj: chunkErrorPlaceholderImg, isLoading: false, isError: true, isTile: false } // Error image is not a tile
                }));
            };
            img.src = result.url;
        } catch (error) {
            console.error(`Error generating chunk ${chunkId}:`, error);
            setLoadedChunks(prev => ({
                ...prev,
                [chunkId]: { ...prev[chunkId], imgObj: chunkErrorPlaceholderImg, isLoading: false, isError: true, isTile: false } // Error image is not a tile
            }));
        }
    }, [loadedChunks, chunkLoadingPlaceholderImg, chunkErrorPlaceholderImg]); // Dependencies

    useEffect(() => {
        // Update view offset to keep player centered
        const newViewOffsetX = playerPosition.x - CANVAS_WIDTH / 2 + PLAYER_SIZE / 2;
        const newViewOffsetY = playerPosition.y - CANVAS_HEIGHT / 2 + PLAYER_SIZE / 2;
        setViewOffset({ x: newViewOffsetX, y: newViewOffsetY });

        // Determine current chunk player is in
        const playerChunkX = Math.floor(playerPosition.x / CHUNK_PIXEL_SIZE);
        const playerChunkY = Math.floor(playerPosition.y / CHUNK_PIXEL_SIZE);

        // Load/generate chunks around the player
        for (let cxOffset = -LOAD_RADIUS; cxOffset <= LOAD_RADIUS; cxOffset++) {
            for (let cyOffset = -LOAD_RADIUS; cyOffset <= LOAD_RADIUS; cyOffset++) {
                const cx = playerChunkX + cxOffset;
                const cy = playerChunkY + cyOffset;
                generateAndLoadChunk(cx, cy);
            }
        }
    }, [playerPosition, generateAndLoadChunk]);


    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false; // For pixel art
        let animationFrameId;

        const gameLoop = () => {
            let newWorldX = playerPosition.x;
            let newWorldY = playerPosition.y;
            if (keysPressed.current['w'] || keysPressed.current['arrowup']) newWorldY -= PLAYER_SPEED;
            if (keysPressed.current['s'] || keysPressed.current['arrowdown']) newWorldY += PLAYER_SPEED;
            if (keysPressed.current['a'] || keysPressed.current['arrowleft']) newWorldX -= PLAYER_SPEED;
            if (keysPressed.current['d'] || keysPressed.current['arrowright']) newWorldX += PLAYER_SPEED;
            
            // No boundary checks for player position in an infinite world
            if (newWorldX !== playerPosition.x || newWorldY !== playerPosition.y) {
                onPlayerMove({ x: newWorldX, y: newWorldY });
            }

            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            
            // Draw Chunks
            Object.values(loadedChunks).forEach(chunk => {
                const canvasX = chunk.worldX - viewOffset.x;
                const canvasY = chunk.worldY - viewOffset.y;

                // Basic culling
                if (canvasX + CHUNK_PIXEL_SIZE > 0 && canvasX < CANVAS_WIDTH &&
                    canvasY + CHUNK_PIXEL_SIZE > 0 && canvasY < CANVAS_HEIGHT) {
                    
                    if (chunk.imgObj && chunk.imgObj.complete && chunk.imgObj.naturalHeight !== 0) {
                        if (chunk.isTile) {
                            // Applies to both generated terrain tiles and the loading mist tile
                            const pattern = ctx.createPattern(chunk.imgObj, 'repeat');
                            ctx.fillStyle = pattern;
                            // Translate pattern by viewOffset to keep it aligned with world space
                            ctx.save();
                            ctx.translate(canvasX, canvasY);
                            ctx.fillRect(0,0, CHUNK_PIXEL_SIZE, CHUNK_PIXEL_SIZE);
                            ctx.restore();
                        } else { 
                            // Applies to non-tile images like the error placeholder
                            // Draw it scaled to fill the chunk
                            ctx.drawImage(chunk.imgObj, canvasX, canvasY, CHUNK_PIXEL_SIZE, CHUNK_PIXEL_SIZE);
                        }
                    } else if (chunk.isLoading) { 
                        // Fallback if chunk.imgObj (e.g. chunkLoadingPlaceholderImg) isn't ready or if terrain is fetching
                        ctx.fillStyle = 'rgba(50,50,50,0.8)';
                        ctx.fillRect(canvasX, canvasY, CHUNK_PIXEL_SIZE, CHUNK_PIXEL_SIZE);
                        ctx.fillStyle = 'white';
                        ctx.textAlign = 'center';
                        ctx.fillText('Loading...', canvasX + CHUNK_PIXEL_SIZE / 2, canvasY + CHUNK_PIXEL_SIZE / 2);
                        ctx.textAlign = 'left'; // Reset alignment
                    } else {
                        // Fallback for other unexpected states (e.g. not loading, no error, but no image)
                        ctx.fillStyle = 'rgba(20,20,20,0.9)'; // Darker fill for error/missing
                        ctx.fillRect(canvasX, canvasY, CHUNK_PIXEL_SIZE, CHUNK_PIXEL_SIZE);
                        if (chunkErrorPlaceholderImg.complete && chunkErrorPlaceholderImg.naturalHeight !== 0) {
                            // Attempt to draw a generic error symbol if available and chunk.imgObj was null
                             const symbolSize = Math.min(CHUNK_PIXEL_SIZE / 2, 128); // Draw symbol smaller
                             ctx.drawImage(
                                 chunkErrorPlaceholderImg, 
                                 canvasX + (CHUNK_PIXEL_SIZE - symbolSize) / 2, 
                                 canvasY + (CHUNK_PIXEL_SIZE - symbolSize) / 2, 
                                 symbolSize, 
                                 symbolSize
                            );
                        } else {
                            ctx.fillStyle = 'grey';
                            ctx.textAlign = 'center';
                            ctx.fillText('Error', canvasX + CHUNK_PIXEL_SIZE / 2, canvasY + CHUNK_PIXEL_SIZE / 2);
                            ctx.textAlign = 'left'; // Reset alignment
                        }
                    }
                }
            });
            
            // Draw effects (world coordinates)
            effects.forEach(effect => {
                const effectCanvasX = effect.x - viewOffset.x;
                const effectCanvasY = effect.y - viewOffset.y;
                const effectRenderSize = effect.width || EFFECT_SIZE;


                if (effectCanvasX + effectRenderSize > 0 && effectCanvasX < CANVAS_WIDTH &&
                    effectCanvasY + effectRenderSize > 0 && effectCanvasY < CANVAS_HEIGHT) {
                    if (effect.imgObj && !effect.isError) {
                         ctx.drawImage(effect.imgObj, effectCanvasX, effectCanvasY, effectRenderSize, effect.height || EFFECT_SIZE);
                    } else if (effect.isError && effect.imgObj) { // Loaded error placeholder for effect
                         ctx.drawImage(effect.imgObj, effectCanvasX, effectCanvasY, EFFECT_SIZE, EFFECT_SIZE);
                    } else if (effect.isLoading) { // Effect image is loading
                        ctx.fillStyle = 'rgba(100,100,100,0.5)';
                        ctx.fillRect(effectCanvasX, effectCanvasY, EFFECT_SIZE, EFFECT_SIZE);
                        ctx.fillStyle = 'white';
                        ctx.fillText('FX...', effectCanvasX + 5, effectCanvasY + EFFECT_SIZE/2);
                    }
                }
            });
            
            // Draw player (always centered on canvas, viewOffset handles world movement)
            if (playerImage) {
                const playerCanvasX = playerPosition.x - viewOffset.x;
                const playerCanvasY = playerPosition.y - viewOffset.y;
                ctx.drawImage(playerImage, playerCanvasX, playerCanvasY, PLAYER_SIZE, PLAYER_SIZE);
            }

            animationFrameId = requestAnimationFrame(gameLoop);
        };
        gameLoop();
        return () => cancelAnimationFrame(animationFrameId);
    }, [playerImage, playerPosition, onPlayerMove, effects, loadedChunks, viewOffset, chunkLoadingPlaceholderImg, chunkErrorPlaceholderImg]); // Added placeholders to deps

    return <canvas ref={canvasRef} id="gameCanvas" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />;
}

function HudOverlay({ currentUser, playerPower, handleInteraction, loadingStates, evolutionInProgress }) {
    return (
        <div className="hud-overlay">
            <div className="user-info">
                {currentUser.username}
                <img src={`https://images.websim.com/avatar/${currentUser.username}`} alt="avatar" />
                 {evolutionInProgress && <span style={{ marginLeft: '10px', color: '#00ff99' }}> (Adapting power...)</span>}
            </div>
            
            <h3 style={{marginTop: '10px', color:'#ffcc00', fontSize: '1.0em', textAlign: 'center', marginBottom: '5px'}}>
                Abilities [{playerPower.name}]
            </h3>
            <div className="active-elements-grid">
                {playerPower.currentElements.map((element) => (
                    <div key={element.instanceId} className="element-control">
                        <button 
                            onClick={() => handleInteraction(element)}
                            disabled={loadingStates[element.instanceId] || evolutionInProgress}
                            title={element.name} // Tooltip for element name
                        >
                            {loadingStates[element.instanceId] ? 'Processing...' : element.datapoint.interactionPrompt}
                        </button>
                         <DataLog collectionType={element.datapoint.type} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function DataLog({ collectionType }) {
    const items = useSyncExternalStore(
        useCallback(room.collection(collectionType).subscribe, [collectionType]),
        useCallback(room.collection(collectionType).getList, [collectionType])
    );
    const [showLog, setShowLog] = useState(false);

    if (!items) { // Handle case where items might be undefined initially
        return <p style={{fontSize: '0.75em', color: '#888', marginTop: '5px'}}>Loading log...</p>;
    }
    
    return (
        <div style={{marginTop: '5px'}}>
            <button onClick={() => setShowLog(!showLog)} style={{fontSize: '0.7em', padding: '2px 4px', backgroundColor: '#555'}}>
                {showLog ? 'Hide' : 'Show'} Log ({items.length})
            </button>
            {showLog && (
                <div className="data-log">
                    {items.length === 0 && <div className="data-log-entry">No '{collectionType}' data yet.</div>}
                    {items.slice().reverse().slice(0, 3).map(item => ( 
                        <div key={item.id} className="data-log-entry">
                            <strong>{item.username}</strong> ({new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}): {item.message || 'Generic update'}
                        </div>
                    ))}
                    {items.length > 3 && <div className="data-log-entry">...and {items.length - 3} more.</div>}
                </div>
            )}
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);