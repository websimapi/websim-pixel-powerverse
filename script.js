const { useState, useEffect, useSyncExternalStore, useCallback, useMemo } = React;

const room = new WebsimSocket();

function App() {
    const [playerPower, setPlayerPower] = useState(null);
    const [visualEffects, setVisualEffects] = useState({}); // Store effect URLs by elementId
    const [loadingStates, setLoadingStates] = useState({}); // Store loading states by elementId
    const [currentUser, setCurrentUser] = useState(null);
    const [evolutionInProgress, setEvolutionInProgress] = useState(false);

    useEffect(() => {
        websim.getCurrentUser().then(setCurrentUser);
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
                currentElements: randomPowerTemplate.baseElements.map(el => ({...el, instanceId: Date.now() + Math.random().toString(36).substr(2,9) })), // Unique ID for each element instance
                potentialEvolutions: randomPowerTemplate.potentialEvolutions, // Store potential evolutions
                interactionCount: 0, // For simple evolution tracking
            };
            setPlayerPower(initialPower);
            localStorage.setItem('playerPower', JSON.stringify(initialPower));
        }
    }, []);

    const handleInteraction = useCallback(async (element) => {
        if (!currentUser || !playerPower) return;

        setLoadingStates(prev => ({ ...prev, [element.instanceId]: true }));
        setVisualEffects(prev => ({ ...prev, [element.instanceId]: null })); // Clear previous

        try {
            // 1. Create a record for the interaction
            await room.collection(element.datapoint.type).create({
                powerId: playerPower.id,
                elementId: element.id,
                interactionType: element.datapoint.interactionPrompt,
                timestamp: new Date().toISOString(),
                message: `${currentUser.username} used ${element.name} (${playerPower.name})`
            });
            
            // 2. Generate visual effect if trigger is on_interaction
            if (element.visualEffect.trigger === 'on_interaction') {
                const imageResult = await websim.imageGen({ prompt: element.visualEffect.prompt, aspect_ratio: "1:1" });
                setVisualEffects(prev => ({ ...prev, [element.instanceId]: imageResult.url }));
            }
            
            // 3. Update interaction count for evolution
            setPlayerPower(prevPower => {
                const newPower = {...prevPower, interactionCount: (prevPower.interactionCount || 0) + 1};
                localStorage.setItem('playerPower', JSON.stringify(newPower));
                return newPower;
            });

        } catch (error) {
            console.error("Error during interaction:", error);
            setVisualEffects(prev => ({ ...prev, [element.instanceId]: 'error.png' })); // Placeholder for error
        } finally {
            setLoadingStates(prev => ({ ...prev, [element.instanceId]: false }));
        }
    }, [currentUser, playerPower]);
    
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
            useEffect(() => {
                if (dataList.length > 0 && !loadingStates[element.instanceId]) { // Basic trigger: new data arrived
                    // To prevent spamming image gen, only trigger if not already loading an effect for this element
                    // And perhaps add a cooldown or check if the latest data is truly "new" for this user.
                    // For simplicity, this will regenerate on any list change.
                    const generateEffect = async () => {
                        setLoadingStates(prev => ({ ...prev, [element.instanceId]: true }));
                        try {
                            console.log(`Data change detected for ${element.datapoint.type}, generating effect for ${element.name}`);
                            const imageResult = await websim.imageGen({ prompt: element.visualEffect.prompt, aspect_ratio: "1:1" });
                            setVisualEffects(prev => ({ ...prev, [element.instanceId]: imageResult.url }));
                        } catch (error) {
                            console.error("Error generating visual effect on data change:", error);
                            setVisualEffects(prev => ({ ...prev, [element.instanceId]: 'error.png' }));
                        } finally {
                            setLoadingStates(prev => ({ ...prev, [element.instanceId]: false }));
                        }
                    };
                    generateEffect();
                }
            // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [dataList, element.instanceId, element.visualEffect.prompt]); // Re-run if dataList or element details change
        }
    });


    const attemptEvolution = useCallback(async () => {
        if (!playerPower || !playerPower.potentialEvolutions || playerPower.potentialEvolutions.length === 0) {
            alert("No more evolutions currently available for this power, or evolution path not defined.");
            return;
        }
        setEvolutionInProgress(true);

        try {
            // Simple evolution: pick the next available one from predefined list
            const nextEvolution = playerPower.potentialEvolutions[0]; // Get the first one

            // LLM to add flavor or slightly customize (optional, for future enhancement)
            // For now, directly use the predefined evolution
            
            const newElement = {
                id: nextEvolution.datapoint.type.replace(/_v\d+$/, '') + '_' + Date.now().toString(36), // semi-unique id
                instanceId: Date.now() + Math.random().toString(36).substr(2,9), // Unique ID for react key and state
                name: nextEvolution.name,
                datapoint: nextEvolution.datapoint,
                visualEffect: nextEvolution.visualEffect,
            };

            setPlayerPower(prevPower => {
                const updatedPower = {
                    ...prevPower,
                    currentElements: [...prevPower.currentElements, newElement],
                    potentialEvolutions: prevPower.potentialEvolutions.slice(1), // Remove the used evolution
                    interactionCount: 0 // Reset count or have different counts for different evolution tiers
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


    if (!playerPower || !currentUser) {
        return <div className="loading-text">Initializing Player PowerVerse...</div>;
    }
    
    const currentPowerTemplate = ALL_SUPERPOWERS.find(p => p.id === playerPower.id);

    return (
        <div className="app-container">
            <header className="header">Pixel PowerVerse</header>
            <p style={{textAlign: 'center'}}>Welcome, {currentUser.username}! Your avatar: <img src={`https://images.websim.com/avatar/${currentUser.username}`} alt="avatar" style={{width: '32px', height: '32px', verticalAlign: 'middle', borderRadius: '50%'}} /></p>
            
            <div className="main-content">
                <div className="player-panel">
                    <h2>Your Power: {playerPower.name}</h2>
                    <div className="power-info">
                        <p>{playerPower.description}</p>
                        <p>Interaction Count: {playerPower.interactionCount}</p>
                         {currentPowerTemplate && currentPowerTemplate.potentialEvolutions.length > 0 && playerPower.potentialEvolutions && playerPower.potentialEvolutions.length > 0 && (
                             <button onClick={attemptEvolution} disabled={evolutionInProgress || playerPower.potentialEvolutions.length === 0}>
                                {evolutionInProgress ? "Evolving..." : `Attempt Evolution (${playerPower.potentialEvolutions.length} available)`}
                            </button>
                         )}
                         {(!playerPower.potentialEvolutions || playerPower.potentialEvolutions.length === 0) && <p>Max evolution reached for now!</p>}
                    </div>

                    <h3>Active Elements:</h3>
                    {playerPower.currentElements.map((element) => (
                        <div key={element.instanceId} className="power-element">
                            <h4>{element.name}</h4>
                            <p><strong>Datapoint:</strong> {element.datapoint.description} (Type: <code>{element.datapoint.type}</code>)</p>
                            <p><strong>Visual Effect Trigger:</strong> {element.visualEffect.trigger}</p>
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

                <div className="effect-panel">
                    <h2>Visual Manifestations</h2>
                    {playerPower.currentElements.map(element => (
                        <div key={`vis-${element.instanceId}`} className="visual-effect-display-container" style={{marginBottom: '10px'}}>
                            <h4>Effect for: {element.name}</h4>
                            <div className="visual-effect-display">
                                {loadingStates[element.instanceId] && <p className="loading-text">Generating effect...</p>}
                                {!loadingStates[element.instanceId] && visualEffects[element.instanceId] && visualEffects[element.instanceId] !== 'error.png' && (
                                    <img src={visualEffects[element.instanceId]} alt="Visual Effect" />
                                )}
                                {!loadingStates[element.instanceId] && visualEffects[element.instanceId] === 'error.png' && (
                                    <p className="placeholder-text">Error loading effect. <img src="error_placeholder.png" alt="Error placeholder" style={{width: "50px", height:"50px"}}/></p>
                                )}
                                {!loadingStates[element.instanceId] && !visualEffects[element.instanceId] && (
                                    <p className="placeholder-text">Interact or wait for data change to see effect. <img src="effect_placeholder.png" alt="Effect placeholder" style={{width: "50px", height:"50px"}}/></p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
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
        return <p style={{fontSize: '0.8em', color: '#aaa'}}>No '{collectionType}' data yet.</p>;
    }

    return (
        <div>
            <button onClick={() => setShowLog(!showLog)} style={{fontSize: '0.8em', padding: '3px 6px', marginTop: '5px', backgroundColor: '#555'}}>
                {showLog ? 'Hide' : 'Show'} {collectionType} Log ({items.length})
            </button>
            {showLog && (
                <div className="data-log">
                    {items.slice().reverse().slice(0, 5).map(item => ( // Show latest 5
                        <div key={item.id} className="data-log-entry">
                            <strong>{item.username}</strong> ({new Date(item.created_at).toLocaleTimeString()}): {item.message || JSON.stringify(item, (key, value) => key === 'username' || key === 'created_at' || key === 'id' || key === 'type' ? undefined : value, 2)}
                        </div>
                    ))}
                    {items.length > 5 && <div className="data-log-entry">...and {items.length - 5} more.</div>}
                </div>
            )}
        </div>
    );
}


const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

