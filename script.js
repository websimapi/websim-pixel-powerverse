const { useState, useEffect, useSyncExternalStore, useCallback, useMemo, useRef } = React;

const room = new WebsimSocket();

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 32;
const EFFECT_SIZE = 64; // Effects are a bit larger
const EFFECT_DURATION_MS = 5000; // 5 seconds
const PLAYER_SPEED = 5;

// New constants for chunk system
const CHUNK_PIXEL_SIZE = 256; // Each chunk is 256x256 pixels
const LOAD_RADIUS = 1; // Load chunks in a (LOAD_RADIUS*2+1) x (LOAD_RADIUS*2+1) grid around the player

// URLs for placeholder images (assuming they are in the root directory)
const CHUNK_LOADING_PLACEHOLDER_URL = 'chunk_loading_placeholder.png';
const CHUNK_ERROR_PLACEHOLDER_URL = 'chunk_error_placeholder.png';
const EFFECT_ERROR_PLACEHOLDER_URL = 'error_placeholder.png';

function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [playerPower, setPlayerPower] = useState(null);
    // Player position is now world coordinates
    const [playerPosition, setPlayerPosition] = useState(() => {
        const savedPos = localStorage.getItem('playerPosition');
        return savedPos ? JSON.parse(savedPos) : { x: 0, y: 0 }; // Default to world origin
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
                currentElements: randomPowerTemplate.baseElements.map(el => ({ ...el, instanceId: Date.now() + Math.random().toString(36).substr(2, 9) })),
                potentialEvolutions: randomPowerTemplate.potentialEvolutions,
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
                    errorImg.onload = () => setCanvasEffects(prevs => prevs.map(e => e.id === effectId ? {...e, imgObj: errorImg, width: EFFECT_SIZE, height: EFFECT_SIZE} : e)); // Use default EFFECT_SIZE for placeholder
                    errorImg.src = EFFECT_ERROR_PLACEHOLDER_URL;
                    return {...ef, imgObj: null, isLoading: true}; 
                 }
                 return ef;
            }));
        };
        img.src = isError ? EFFECT_ERROR_PLACEHOLDER_URL : url; // Use error placeholder if isError is true initially

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
                    if (ef.isLoading && !ef.isError) return true; // Keep loading non-error effects
                    if (ef.isError && ef.isLoading) return true; // Keep loading error placeholder
                    return Date.now() - ef.createdAt < EFFECT_DURATION_MS;
                })
            );
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const handleInteraction = useCallback(async (element) => {
        if (!currentUser || !playerPower) return;

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

            setPlayerPower(prevPower => {
                const newPower = { ...prevPower, interactionCount: (prevPower.interactionCount || 0) + 1 };
                localStorage.setItem('playerPower', JSON.stringify(newPower));
                return newPower;
            });

        } catch (error) {
            console.error("Error during interaction:", error);
            addEffectToCanvas(EFFECT_ERROR_PLACEHOLDER_URL, playerPosition, element.instanceId, true); // playerPosition is world coords
        } finally {
            setLoadingStates(prev => ({ ...prev, [element.instanceId]: false }));
        }
    }, [currentUser, playerPower, playerPosition, addEffectToCanvas]);

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
                if (dataList.length > lastProcessedCount.current && !loadingStates[element.instanceId]) {
                    lastProcessedCount.current = dataList.length;
                    const generateEffect = async () => {
                        setLoadingStates(prev => ({ ...prev, [element.instanceId]: true }));
                        try {
                            const imageResult = await websim.imageGen({ prompt: element.visualEffect.prompt, aspect_ratio: "1:1", transparent: true });
                            // playerPosition is world coords
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
            }, [dataList, element.instanceId, element.visualEffect.prompt, addEffectToCanvas, playerPosition]);
        }
    });
    
    const attemptEvolution = useCallback(async () => {
        if (!playerPower || !playerPower.potentialEvolutions || playerPower.potentialEvolutions.length === 0) {
            alert("No more evolutions available.");
            return;
        }
        setEvolutionInProgress(true);
        try {
            const nextEvolution = playerPower.potentialEvolutions[0];
            const newElement = {
                id: nextEvolution.datapoint.type.replace(/_v\d+$/, '') + '_' + Date.now().toString(36),
                instanceId: Date.now() + Math.random().toString(36).substr(2, 9),
                name: nextEvolution.name,
                datapoint: nextEvolution.datapoint,
                visualEffect: nextEvolution.visualEffect,
            };
            setPlayerPower(prevPower => {
                const updatedPower = {
                    ...prevPower,
                    currentElements: [...prevPower.currentElements, newElement],
                    potentialEvolutions: prevPower.potentialEvolutions.slice(1),
                    interactionCount: 0 
                };
                localStorage.setItem('playerPower', JSON.stringify(updatedPower));
                alert(`Power Evolved! You gained: ${newElement.name}`);
                return updatedPower;
            });
        } catch (error) {
            console.error("Error attempting evolution:", error);
            alert("An error occurred during evolution.");
        } finally {
            setEvolutionInProgress(false);
        }
    }, [playerPower]);

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
                attemptEvolution={attemptEvolution}
                loadingStates={loadingStates}
                evolutionInProgress={evolutionInProgress}
            />
        </div>
    );
}

function GameCanvas({ playerImage, playerPosition, onPlayerMove, effects }) {
    const canvasRef = useRef(null);
    const keysPressed = useRef({});
    const [loadedChunks, setLoadedChunks] = useState({}); // { "cx_cy": { imgObj, worldX, worldY, isLoading, isError, id } }
    const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });

    // Preload placeholder images
    const chunkLoadingPlaceholderImg = useMemo(() => {
        const img = new Image();
        img.src = CHUNK_LOADING_PLACEHOLDER_URL;
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

        setLoadedChunks(prev => ({
            ...prev,
            [chunkId]: {
                id: chunkId,
                worldX: cx * CHUNK_PIXEL_SIZE,
                worldY: cy * CHUNK_PIXEL_SIZE,
                imgObj: null,
                isLoading: true,
                isError: false
            }
        }));

        try {
            // Generate a unique-ish prompt based on coordinates for varied terrain
            // Using a simple seed based on coordinates for some variation
            const seed = Math.abs(cx * 31 + cy * 17); 
            let terrainFeature = "grassy plains";
            if (seed % 10 < 2) terrainFeature = "light forest";
            else if (seed % 10 < 4) terrainFeature = "rocky patches";
            else if (seed % 10 < 5) terrainFeature = "a small pond";
            
            const prompt = `Pixel art terrain tile for chunk coordinates (${cx}, ${cy}). Style: Vibrant 16-bit fantasy RPG world. Features: mostly ${terrainFeature}. Seamlessly tileable. Aspect: 1:1.`;
            
            const result = await websim.imageGen({ prompt, aspect_ratio: "1:1", width: CHUNK_PIXEL_SIZE, height: CHUNK_PIXEL_SIZE });
            const img = new Image();
            img.onload = () => {
                setLoadedChunks(prev => ({
                    ...prev,
                    [chunkId]: { ...prev[chunkId], imgObj: img, isLoading: false }
                }));
            };
            img.onerror = () => {
                 console.error(`Failed to load chunk image for ${chunkId} from URL: ${result.url}`);
                 setLoadedChunks(prev => ({
                    ...prev,
                    [chunkId]: { ...prev[chunkId], imgObj: chunkErrorPlaceholderImg, isLoading: false, isError: true }
                }));
            };
            img.src = result.url;
        } catch (error) {
            console.error(`Error generating chunk ${chunkId}:`, error);
            setLoadedChunks(prev => ({
                ...prev,
                [chunkId]: { ...prev[chunkId], imgObj: chunkErrorPlaceholderImg, isLoading: false, isError: true }
            }));
        }
    }, [loadedChunks, chunkErrorPlaceholderImg]); // Ensure chunkErrorPlaceholderImg is stable or included in deps

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

                // Basic culling: only draw if chunk is somewhat visible
                if (canvasX + CHUNK_PIXEL_SIZE > 0 && canvasX < CANVAS_WIDTH &&
                    canvasY + CHUNK_PIXEL_SIZE > 0 && canvasY < CANVAS_HEIGHT) {
                    if (chunk.imgObj) {
                        ctx.drawImage(chunk.imgObj, canvasX, canvasY, CHUNK_PIXEL_SIZE, CHUNK_PIXEL_SIZE);
                    } else if (chunk.isLoading) {
                         if (chunkLoadingPlaceholderImg.complete && chunkLoadingPlaceholderImg.naturalHeight !== 0) {
                            ctx.drawImage(chunkLoadingPlaceholderImg, canvasX, canvasY, CHUNK_PIXEL_SIZE, CHUNK_PIXEL_SIZE);
                         } else { // Fallback drawing if placeholder not loaded yet
                            ctx.fillStyle = 'rgba(50,50,50,0.8)';
                            ctx.fillRect(canvasX, canvasY, CHUNK_PIXEL_SIZE, CHUNK_PIXEL_SIZE);
                            ctx.fillStyle = 'white';
                            ctx.fillText('Loading chunk...', canvasX + 10, canvasY + CHUNK_PIXEL_SIZE/2);
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
    }, [playerImage, playerPosition, onPlayerMove, effects, loadedChunks, viewOffset, chunkLoadingPlaceholderImg]);

    return <canvas ref={canvasRef} id="gameCanvas" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />;
}

function HudOverlay({ currentUser, playerPower, currentPowerTemplate, handleInteraction, attemptEvolution, loadingStates, evolutionInProgress}) {
    return (
        <div className="hud-overlay">
            <div className="hud-header">Player Console</div>
            <div className="user-info">
                Welcome, {currentUser.username}!
                <img src={`https://images.websim.com/avatar/${currentUser.username}`} alt="avatar" />
            </div>

            <div className="power-status">
                <h2>Power: {playerPower.name}</h2>
                <p>{playerPower.description}</p>
                <p>Interaction Count: {playerPower.interactionCount}</p>
                {currentPowerTemplate && currentPowerTemplate.potentialEvolutions.length > 0 && playerPower.potentialEvolutions && playerPower.potentialEvolutions.length > 0 && (
                     <button onClick={attemptEvolution} disabled={evolutionInProgress || playerPower.potentialEvolutions.length === 0}>
                        {evolutionInProgress ? "Evolving..." : `Attempt Evolution (${playerPower.potentialEvolutions.length} available)`}
                    </button>
                 )}
                 {(!playerPower.potentialEvolutions || playerPower.potentialEvolutions.length === 0) && <p>Max evolution reached for now!</p>}
            </div>

            <h3 style={{marginTop: '15px', color:'#ffcc00', fontSize: '1.1em'}}>Active Elements:</h3>
            <div className="active-elements-grid">
                {playerPower.currentElements.map((element) => (
                    <div key={element.instanceId} className="element-control">
                        <h4>{element.name}</h4>
                        <p><strong>Datapoint:</strong> {element.datapoint.description} (<code>{element.datapoint.type}</code>)</p>
                        <p><strong>Effect:</strong> {element.visualEffect.trigger === 'on_interaction' ? 'On Use' : 'On Data Change'}</p>
                        {element.datapoint.interactionPrompt && (
                            <button 
                                onClick={() => handleInteraction(element)}
                                disabled={loadingStates[element.instanceId]}
                            >
                                {loadingStates[element.instanceId] ? 'Processing...' : element.datapoint.interactionPrompt}
                            </button>
                        )}
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

    if (!items || items.length === 0) {
        return <p style={{fontSize: '0.75em', color: '#888', marginTop: '5px'}}>No '{collectionType}' data yet.</p>;
    }

    return (
        <div style={{marginTop: '5px'}}>
            <button onClick={() => setShowLog(!showLog)} style={{fontSize: '0.7em', padding: '2px 4px', backgroundColor: '#555'}}>
                {showLog ? 'Hide' : 'Show'} Log ({items.length})
            </button>
            {showLog && (
                <div className="data-log">
                    {items.slice().reverse().slice(0, 3).map(item => ( // Show latest 3
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