import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Users, UserPlus, RefreshCw } from 'lucide-react';

const PlanningPoker = () => {
  const [sessionId, setSessionId] = useState('');
  const [userName, setUserName] = useState('');
  const [session, setSession] = useState(null);
  const [newParticipant, setNewParticipant] = useState('');
  const [socket, setSocket] = useState(null);
  const [isJoining, setIsJoining] = useState(false);

  const connectWebSocket = useCallback(() => {
    if (sessionId && userName) {
      setIsJoining(true);
      
      const ws = new WebSocket(`${(window.location.protocol == "https:") ? "wss" : "ws"}://${window.location.host}/ws?session=${sessionId}`);
      
      ws.onopen = () => {
        console.log('Connected to WebSocket');
        ws.send(JSON.stringify({ type: 'join', name: userName }));
        setIsJoining(false);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setSession(data);
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
        setIsJoining(false);
      };

      setSocket(ws);
    }
  }, [sessionId, userName]);

  useEffect(() => {
    return () => {
      if (socket) {
        socket.close();
      }
    };
  }, [socket]);

  const sendMessage = (type, data = {}) => {
    if (socket) {
      socket.send(JSON.stringify({ type, ...data }));
    }
  };

  const addParticipant = () => {
    if (newParticipant) {
      sendMessage('join', { name: newParticipant });
      setNewParticipant('');
    }
  };

  const castVote = (value) => {
    sendMessage('vote', { name: userName, vote: value });
  };

  const revealVotes = () => {
    sendMessage('reveal');
  };

  const resetVotes = () => {
    sendMessage('reset');
  };

  const calculateAverage = () => {
    if (!session || !session.revealed || !session.participants) return 'N/A';
    const votes = Object.values(session.participants).map(p => p.vote).filter(v => v > 0);
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
              <Button type="submit" disabled={isJoining}>
                {isJoining ? 'Joining...' : 'Join Session'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Users className="mr-2" />
            Planning Poker Session: {sessionId}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* <div className="flex mb-4">
            <Input
              type="text"
              value={newParticipant}
              onChange={(e) => setNewParticipant(e.target.value)}
              placeholder="Enter participant name"
              className="mr-2"
            />
            <Button onClick={addParticipant}>
              <UserPlus className="mr-2" /> Add Participant
            </Button>
          </div> */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {session && session.participants && Object.entries(session.participants).map(([name, participant]) => (
              <Card key={name}>
                <CardHeader>
                  <CardTitle>{name}</CardTitle>
                </CardHeader>
                <CardContent>
                  {session.revealed || name === userName ? (
                    <div className="text-2xl font-bold">{participant.vote || 'Not voted'}</div>
                  ) : (
                    <div className="text-2xl font-bold">{participant.vote ? 'Voted' : 'Not voted'}</div>
                  )}
                  {name === userName && !session.revealed && (
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
        <Button onClick={revealVotes} disabled={session && session.revealed}>Reveal Votes</Button>
        <div className="text-xl font-bold">Average: {calculateAverage()}</div>
        <Button onClick={resetVotes} variant="outline">
          <RefreshCw className="mr-2" /> Reset
        </Button>
      </div>
    </div>
  );
};

export default PlanningPoker;