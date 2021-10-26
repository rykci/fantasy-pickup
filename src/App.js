import './App.css'
import { useState } from 'react'
import {
  Button,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
} from '@mui/material'
import styled from 'styled-components'

function App() {
  const [playerList, setPlayerList] = useState([])
  const [isPoolMade, setIsPoolMade] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const PAGES = 45970

  const getPlayerPool = async () => {
    setIsLoading(true)
    const playerPool = []

    while (playerPool.length < 20) {
      const player = await fetchPlayer()

      if (Object.values(player.stats).reduce((a, b) => a + b, 0) >= 20) {
        console.log(player)
        playerPool.push(player)
      }
    }

    playerPool.sort((a, b) => {
      if (a.name < b.name) {
        return -1
      }
      if (a.name > b.name) {
        return 1
      }
      return 0
    })

    setPlayerList(playerPool)
    setIsPoolMade(true)
    setIsLoading(false)
  }

  const fetchPlayer = async () => {
    const page = Math.floor(Math.random() * PAGES) + 1
    const index = Math.floor(Math.random() * 25)

    //https://rapidapi.com/theapiguy/api/free-nba/
    return fetch(`https://free-nba.p.rapidapi.com/stats?page=${page}`, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'free-nba.p.rapidapi.com',
        'x-rapidapi-key': '21c9356c99mshc029bf82afeabf7p101ad3jsn1abb9005eb40',
      },
    })
      .then((response) => response.json())
      .then((res) => {
        const playerData = res.data[index]

        const player = {
          name: `${playerData.player.first_name} ${playerData.player.last_name}`,
          team: `'${playerData.game.date.substring(2, 4)} ${
            playerData.team.full_name
          }`,
          date: playerData.game.date.split('T')[0],
          stats: {
            pts: playerData.pts || 0,
            fgp: playerData.fg_pct || 0,
            ftp: playerData.ft_pct || 0,
            fg3m: playerData.fg3m || 0,
            ast: playerData.ast || 0,
            reb: playerData.reb || 0,
            stl: playerData.stl || 0,
            blk: playerData.blk || 0,
            to: playerData.turnover || 0,
          },
        }

        return player
        //console.log(player)
      })
      .catch((err) => {
        console.error(err)
      })
  }

  if (isPoolMade) {
    return (
      <PlayerPool>
        {playerList.map((player) => {
          return (
            <Player key={`${player.name}${player.date}`}>
              <PlayerText primary={player.name} secondary={player.team} />
            </Player>
          )
        })}
      </PlayerPool>
    )
  } else if (isLoading) {
    return (
      <Center>
        <CircularProgress />
      </Center>
    )
  } else
    return (
      <div className="App">
        <header className="App-header">
          <FetchButton variant="contained" onClick={getPlayerPool}>
            ROLL PLAYER
          </FetchButton>
          <FetchButton
            variant="contained"
            onClick={() => console.log(playerList)}
          >
            PRINT POOL
          </FetchButton>
        </header>
      </div>
    )
}

const FetchButton = styled(Button)``

const PlayerPool = styled(List)`
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
`

const Player = styled(ListItem)``

const PlayerText = styled(ListItemText)``

const Center = styled.div`
  height: 100vh;
  display: grid;
  place-items: Center;
`

export default App
