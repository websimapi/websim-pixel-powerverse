const { useState, useEffect, useSyncExternalStore, useCallback, useMemo, useRef } = React;

const room = new WebsimSocket();

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 32;
const EFFECT_SIZE = 64; // Effects are a bit larger
const EFFECT_DURATION_MS = 5000; // 5 seconds
const PLAYER_SPEED = 5;

function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [playerPower, setPlayerPower] = useState(null);
    const [playerPosition, setPlayerPosition] = useState({ x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 });
    const [playerImage, setPlayerImage] = useState(null);
    const [canvasEffects, setCanvasEffects] = useState([]); // { id, url, x, y, createdAt, imgObj, isLoading, isError }
    const [loadingStates, setLoadingStates] = useState({}); // For button interactions: { [elementInstanceId]: boolean }
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

    const addEffectToCanvas = useCallback((url, position, elementInstanceId = null, isError = false) => {
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
                 ef.id === effectId ? { ...ef, isLoading: false, isError: true, url: 'error_placeholder.png', imgObj: null } : ef
            ).map(ef => { // Attempt to load error placeholder if this one failed
                 if(ef.id === effectId && ef.isError && !ef.imgObj) {
                    const errorImg = new Image();
                    errorImg.onload = () => setCanvasEffects(prevs => prevs.map(e => e.id === effectId ? {...e, imgObj: errorImg, width: errorImg.width, height: errorImg.height} : e));
                    errorImg.src = 'error_placeholder.png'; // Assuming error_placeholder.png is available
                    return {...ef, imgObj: null, isLoading: true}; // Mark as loading error image
                 }
                 return ef;
            }));
        };
        img.src = url;

        setCanvasEffects(prev => [...prev, {
            id: effectId,
            url: url,
            x: position.x - EFFECT_SIZE / 2, // Center effect on position
            y: position.y - EFFECT_SIZE / 2,
            createdAt: Date.now(),
            imgObj: null,
            isLoading: true,
            isError: isError,
            elementInstanceId: elementInstanceId,
            width: EFFECT_SIZE, // Default sizes
            height: EFFECT_SIZE,
        }]);
    }, []);
    
    useEffect(() => {
        const timer = setInterval(() => {
            setCanvasEffects(prevEffects =>
                prevEffects.filter(ef => {
                    if (ef.isLoading) return true;
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
                message: `${currentUser.username} used ${element.name} (${playerPower.name}) at ${Math.round(playerPosition.x)},${Math.round(playerPosition.y)}`
            });

            if (element.visualEffect.trigger === 'on_interaction') {
                const imageResult = await websim.imageGen({ prompt: element.visualEffect.prompt, aspect_ratio: "1:1", transparent: true });
                addEffectToCanvas(imageResult.url, playerPosition, element.instanceId);
            }

            setPlayerPower(prevPower => {
                const newPower = { ...prevPower, interactionCount: (prevPower.interactionCount || 0) + 1 };
                localStorage.setItem('playerPower', JSON.stringify(newPower));
                return newPower;
            });

        } catch (error) {
            console.error("Error during interaction:", error);
            addEffectToCanvas('error_placeholder.png', playerPosition, element.instanceId, true);
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
                            // For data change, effect might appear at a fixed point or related to data, here using player for simplicity
                            addEffectToCanvas(imageResult.url, playerPosition, element.instanceId); 
                        } catch (error) {
                            console.error("Error generating visual effect on data change:", error);
                            addEffectToCanvas('error_placeholder.png', playerPosition, element.instanceId, true);
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

    const handlePlayerMove = useCallback((newPosition) => {
        setPlayerPosition(newPosition);
    }, []);

    if (!playerPower || !currentUser || !playerImage) {
        return <div className="loading-text">Initializing Pixel PowerVerse Explorer...</div>;
    }
    
    const currentPowerTemplate = ALL_SUPERPOWERS.find(p => p.id === playerPower.id);

    return (
        <div className="game-world">
            <GameCanvas
                playerImage={playerImage}
                playerPosition={playerPosition}
                onPlayerMove={handlePlayerMove}
                effects={canvasEffects}
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

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let animationFrameId;

        const gameLoop = () => {
            let newX = playerPosition.x;
            let newY = playerPosition.y;
            if (keysPressed.current['w'] || keysPressed.current['arrowup']) newY -= PLAYER_SPEED;
            if (keysPressed.current['s'] || keysPressed.current['arrowdown']) newY += PLAYER_SPEED;
            if (keysPressed.current['a'] || keysPressed.current['arrowleft']) newX -= PLAYER_SPEED;
            if (keysPressed.current['d'] || keysPressed.current['arrowright']) newX += PLAYER_SPEED;

            newX = Math.max(0, Math.min(CANVAS_WIDTH - PLAYER_SIZE, newX));
            newY = Math.max(0, Math.min(CANVAS_HEIGHT - PLAYER_SIZE, newY));
            
            if (newX !== playerPosition.x || newY !== playerPosition.y) {
                onPlayerMove({ x: newX, y: newY });
            }

            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            
            // Draw effects first (behind player)
            effects.forEach(effect => {
                if (effect.imgObj && !effect.isError) {
                     ctx.drawImage(effect.imgObj, effect.x, effect.y, effect.width || EFFECT_SIZE, effect.height || EFFECT_SIZE);
                } else if (effect.isError && effect.imgObj) { // Loaded error placeholder
                     ctx.drawImage(effect.imgObj, effect.x, effect.y, EFFECT_SIZE, EFFECT_SIZE);
                } else if (effect.isLoading) {
                    ctx.fillStyle = 'rgba(100,100,100,0.5)';
                    ctx.fillRect(effect.x, effect.y, EFFECT_SIZE, EFFECT_SIZE);
                    ctx.fillStyle = 'white';
                    ctx.fillText('Loading...', effect.x + 5, effect.y + EFFECT_SIZE/2);
                }
            });
            
            // Draw player
            if (playerImage) {
                ctx.drawImage(playerImage, playerPosition.x, playerPosition.y, PLAYER_SIZE, PLAYER_SIZE);
            }


            animationFrameId = requestAnimationFrame(gameLoop);
        };
        gameLoop();
        return () => cancelAnimationFrame(animationFrameId);
    }, [playerImage, playerPosition, onPlayerMove, effects]);

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