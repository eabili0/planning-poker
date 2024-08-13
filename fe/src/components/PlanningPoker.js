import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Users, RefreshCw, Trash2, HelpCircle, Sun, Moon, Edit, UserCircle2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

const PlanningPoker = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState(roomId || '');
  const [userName, setUserName] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [localRole, setLocalRole] = useState(false);
  const [session, setSession] = useState(null);
  const [socket, setSocket] = useState(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [pendingRoleChange, setPendingRoleChange] = useState(false);
  const socketRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const pingTimeoutRef = useRef(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const maxReconnectAttempts = 5;
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const storedDarkMode = localStorage.getItem('darkMode');
    setIsDarkMode(storedDarkMode === 'true');

    const savedUserName = localStorage.getItem('userName');
    if (savedUserName) {
      setUserName(savedUserName);
    }

    let savedParticipantId = localStorage.getItem('participantId');
    if (!savedParticipantId) {
      savedParticipantId = uuidv4();
      localStorage.setItem('participantId', savedParticipantId);
    }
    setParticipantId(savedParticipantId);

    if (roomId) {
      setSessionId(roomId);
      setUserName(savedUserName || 'Anonymous');
      setLocalRole(false);
      connectWebSocket(roomId, savedUserName || 'Anonymous', savedParticipantId, false);
    }

    setIsAdmin(localStorage.getItem('isAdmin') === 'true');
  }, [roomId]);

  useEffect(() => {
    document.body.classList.toggle('dark', isDarkMode);
    localStorage.setItem('darkMode', isDarkMode);
  }, [isDarkMode]);

  const connectWebSocket = useCallback((sid = sessionId, name = userName, pid = participantId, admin = isAdmin) => {
    if (sid && name && pid) {
      setIsJoining(true);
      
      const location = (window.location.protocol === "https:") ? "wss" : "ws";
      const ws = new WebSocket(`${location}://${window.location.host}/${location}?session=${sid}&name=${name}&id=${pid}&admin=${admin}`);
      
      ws.onopen = () => {
        console.log('Connected to WebSocket');
        setIsJoining(false);
        setIsConnected(true);
        setConnectionAttempts(0);
        startPingInterval();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);
          if (data.type === 'pong') {
            clearTimeout(pingTimeoutRef.current);
          } else if (data.type === 'roleChangeConfirmation') {
            setIsAdmin(data.newRole);
            localStorage.setItem('isAdmin', data.newRole);
            setPendingRoleChange(false);
          } else if (data.type === 'nameChangeConfirmation') {
            setUserName(data.newName);
            localStorage.setItem('userName', data.newName);
          } else {
            setSession(data);
            if (!data.participants || !data.participants[pid]) {
              console.log('Participant not found in session, closing connection');
              ws.close();
              setSession(null);
              navigate('/');
            } else {
              // Update local isAdmin state based on session data
              setIsAdmin(data.participants[pid].isAdmin);
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
        setIsJoining(false);
        setIsConnected(false);
        clearPingInterval();
        if (event.code !== 1000 && connectionAttempts < maxReconnectAttempts) {
          console.log(`Attempting to reconnect (${connectionAttempts + 1}/${maxReconnectAttempts})...`);
          setConnectionAttempts(prev => prev + 1);
          setTimeout(() => connectWebSocket(sid, name, pid, admin), 5000);
        } else if (connectionAttempts >= maxReconnectAttempts) {
          console.log('Max reconnection attempts reached. Please try again later.');
          navigate('/');
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
        clearPingInterval();
      };

      socketRef.current = ws;
      setSocket(ws);
    }
  }, [sessionId, userName, participantId, localRole, navigate, connectionAttempts]);

  const startPingInterval = () => {
    clearPingInterval();
    pingIntervalRef.current = setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        console.log('Sending ping');
        socketRef.current.send(JSON.stringify({ type: 'ping' }));
        pingTimeoutRef.current = setTimeout(() => {
          console.log('Ping timeout - no pong received');
          socketRef.current.close();
        }, 5000);
      }
    }, 30000);
  };

  const clearPingInterval = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
    }
  };

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      clearPingInterval();
    };
  }, []);

  const sendMessage = (type, data = {}) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, ...data }));
    } else {
      console.log('WebSocket is not connected. Attempting to reconnect...');
      connectWebSocket();
    }
  };

  const castVote = (value) => {
    sendMessage('vote', { vote: value });
  };

  const revealVotes = () => {
    sendMessage('reveal');
  };

  const resetVotes = () => {
    sendMessage('reset');
  };

  const removeParticipant = (name) => {
    sendMessage('remove', { targetName: name });
  };

  const calculateAverage = () => {
    if (!session || !session.participants || !session.revealed) return 'N/A';
    const votes = Object.values(session.participants)
      .filter(p => p.vote > 0)
      .map(p => p.vote);
    return votes.length ? (votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1) : 'N/A';
  };

  const handleJoinSession = (e) => {
    e.preventDefault();
    if (sessionId && userName) {
      localStorage.setItem('userName', userName);
      navigate(`/rooms/${sessionId}`);
      connectWebSocket();
    }
  };

  const handleNameChange = () => {
    if (newName && newName !== userName) {
      sendMessage('changeName', { newName });
      setIsEditingName(false);
    } else {
      setIsEditingName(false);
    }
  };

  const handleRoleChange = () => {
    const newRole = !isAdmin;
    setIsAdmin(newRole);
    setPendingRoleChange(true);
    sendMessage('changeRole', { newRole });
  };

  const renderVoteValue = (vote) => {
    if (vote === 0) return 'Not voted';
    if (vote === -1) return 'No Vote / Question';
    return vote;
  };

  const renderJoinForm = () => (
    <div className="p-4 max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            <span>Join Planning Poker Session</span>
            <div className="flex items-center space-x-2">
              <Sun className="h-4 w-4" />
              <Switch
                checked={isDarkMode}
                onCheckedChange={setIsDarkMode}
              />
              <Moon className="h-4 w-4" />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoinSession}>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sessionId">Session ID</Label>
                <Input
                  id="sessionId"
                  placeholder="Enter Session ID"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="userName">Your Name</Label>
                <Input
                  id="userName"
                  placeholder="Enter Your Name"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={isJoining}>
                {isJoining ? 'Joining...' : 'Join Session'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );

  const renderSession = () => (
    <div className="p-4 max-w-4xl mx-auto">
      {!isConnected && <div className="text-red-500 mb-4">Disconnected. Attempting to reconnect...</div>}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span><Users className="inline mr-2" />Planning Poker Session: {sessionId}</span>
            <div className="flex items-center space-x-2">
              <Sun className="h-4 w-4" />
              <Switch
                checked={isDarkMode}
                onCheckedChange={setIsDarkMode}
              />
              <Moon className="h-4 w-4" />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {session && session.participants && Object.values(session.participants).map((participant) => (
              <Card key={participant.id} className={participant.id === participantId ? 'border-2 border-blue-500' : ''}>
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    {participant.id === participantId ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center cursor-pointer" onClick={() => {
                              setIsEditingName(true);
                              setNewName(participant.name);
                            }}>
                              {isEditingName ? (
                                <Input
                                  value={newName}
                                  onChange={(e) => setNewName(e.target.value)}
                                  onBlur={handleNameChange}
                                  onKeyPress={(e) => e.key === 'Enter' && handleNameChange()}
                                  className="mr-2"
                                  autoFocus
                                />
                              ) : (
                                <>
                                  <span className="mr-2">{participant.name}</span>
                                  <Edit size={16} />
                                </>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Click to edit your name</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span>{participant.name}</span>
                    )}
                    {participant.id === participantId ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleRoleChange}
                              className={isAdmin ? 'text-yellow-500' : 'text-blue-500'}
                              disabled={pendingRoleChange}
                            >
                              <UserCircle2 size={20} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{isAdmin ? 'Switch to Voter' : 'Switch to Observer'}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (session.participants[participantId] && session.participants[participantId].isAdmin && (
                      <Button onClick={() => removeParticipant(participant.id)} variant="ghost" size="sm">
                        <Trash2 size={16} />
                      </Button>
                    ))}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {participant.isAdmin ? (
                    <div className="text-xl font-bold">
                      {session.revealed && participant.vote !== 0 && (renderVoteValue(participant.vote))}
                      {(!session.revealed || participant.vote === 0) && ("Observer")}
                    </div>
                  ) : session.revealed || participant.id === participantId ? (
                    <div className="text-2xl font-bold">{renderVoteValue(participant.vote)}</div>
                  ) : (
                    <div className="text-2xl font-bold">{participant.vote !== 0 ? 'Voted' : 'Not voted'}</div>
                  )}
                  {participant.id === participantId && !isAdmin && !session.revealed && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {[1, 2, 3, 5, 8, 13].map((value) => (
                        <Button
                          key={value}
                          onClick={() => castVote(value)}
                          variant={participant.vote === value ? 'default' : 'outline'}
                        >
                          {value}
                        </Button>
                      ))}
                      <Button
                        onClick={() => castVote(-1)}
                        variant={participant.vote === -1 ? 'default' : 'outline'}
                        className="col-span-3"
                      >
                        <HelpCircle className="mr-2" /> No Vote / Question
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-between items-center">
        {session && session.participants[participantId] && session.participants[participantId].isAdmin && (
          <Button onClick={revealVotes} disabled={session.revealed}>Reveal Votes</Button>
        )}
        <div className="text-xl font-bold">Average: {calculateAverage()}</div>
        {session && session.participants[participantId] && session.participants[participantId].isAdmin && (
          <Button onClick={resetVotes} variant="outline">
            <RefreshCw className="mr-2" /> Reset
          </Button>
        )}
      </div>
    </div>
  );

  return session ? renderSession() : renderJoinForm();
};

export default PlanningPoker;