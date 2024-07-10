import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Users, RefreshCw, Trash2 } from 'lucide-react';

const PlanningPoker = () => {
  const [sessionId, setSessionId] = useState('');
  const [userName, setUserName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [session, setSession] = useState(null);
  const [newParticipant, setNewParticipant] = useState('');
  const [socket, setSocket] = useState(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const pingTimeoutRef = useRef(null);

  const connectWebSocket = useCallback(() => {
    if (sessionId && userName) {
      setIsJoining(true);
      
      const location = (window.location.protocol === "https:") ? "wss" : "ws";
      const ws = new WebSocket(`${location}://${window.location.host}/${location}?session=${sessionId}&name=${userName}&admin=${isAdmin}`);
      
      ws.onopen = () => {
        console.log('Connected to WebSocket');
        setIsJoining(false);
        setIsConnected(true);
        startPingInterval();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') {
          // Reset the ping timeout on receiving a pong
          clearTimeout(pingTimeoutRef.current);
        } else {
          setSession(data);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
        setIsJoining(false);
        setIsConnected(false);
        clearPingInterval();
        // Attempt to reconnect after a short delay
        setTimeout(() => connectWebSocket(), 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
        clearPingInterval();
      };

      socketRef.current = ws;
      setSocket(ws);
    }
  }, [sessionId, userName, isAdmin]);

  const startPingInterval = () => {
    clearPingInterval(); // Clear any existing interval
    pingIntervalRef.current = setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'ping' }));
        // Set a timeout for the pong response
        pingTimeoutRef.current = setTimeout(() => {
          console.log('Ping timeout - no pong received');
          socketRef.current.close();
        }, 5000); // Wait 5 seconds for a pong before considering the connection dead
      }
    }, 30000); // Send a ping every 30 seconds
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
    if (!session || !session.participants || !session.revealed ) return 'N/A';
    const votes = Object.values(session.participants)
      .filter(p => !p.isAdmin && p.vote > 0)
      .map(p => p.vote);
    return votes.length ? (votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1) : 'N/A';
  };

  const handleJoinSession = (e) => {
    e.preventDefault();
    if (sessionId && userName) {
      connectWebSocket();
    }
  };

  if (!session) {
    return (
      <div className="p-4 max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Join Planning Poker Session</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleJoinSession}>
              <Input
                className="mb-2"
                placeholder="Enter Session ID"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                required
              />
              <Input
                className="mb-2"
                placeholder="Enter Your Name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                required
              />
              <div className="mb-2">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                />
                <label htmlFor="isAdmin" className="ml-2">Join as Observer/Admin</label>
              </div>
              <Button type="submit" disabled={isJoining}>
                {isJoining ? 'Joining...' : 'Join Session'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentUser = session.participants[userName];

  return (
    <div className="p-4 max-w-4xl mx-auto">
      {!isConnected && <div className="text-red-500 mb-4">Disconnected. Attempting to reconnect...</div>}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span><Users className="inline mr-2" />Planning Poker Session: {sessionId}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {session && session.participants && Object.entries(session.participants).filter(([_, participant]) => participant.isActive).map(([name, participant]) => (
              <Card key={name}>
                <CardHeader>
                  <CardTitle className="flex justify-between items-center">
                    {name}
                    {currentUser && currentUser.isAdmin && name !== userName && (
                      <Button onClick={() => removeParticipant(name)} variant="ghost" size="sm">
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {participant.isAdmin ? (
                    <div className="text-xl font-bold">Observer</div>
                  ) : session.revealed || name === userName ? (
                    <div className="text-2xl font-bold">{participant.vote || 'Not voted'}</div>
                  ) : (
                    <div className="text-2xl font-bold">{participant.vote ? 'Voted' : 'Not voted'}</div>
                  )}
                  {name === userName && !participant.isAdmin && !session.revealed && (
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
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
        <div className="flex justify-between items-center">
          {currentUser && currentUser.isAdmin && (
          <Button onClick={revealVotes} disabled={session.revealed}>Reveal Votes</Button>
          )}
          <div className="text-xl font-bold">Average: {calculateAverage()}</div>
          {currentUser && currentUser.isAdmin && (
          <Button onClick={resetVotes} variant="outline">
            <RefreshCw className="mr-2" /> Reset
          </Button>
          )}
        </div>
    </div>
  );
};

export default PlanningPoker;