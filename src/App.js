import './App.css'
import { useState } from 'react'
import {
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  CircularProgress,
  Typography,
} from '@mui/material'
import styled from 'styled-components'
import Calculator from './components/Calculator'

function App() {
  const [playerList, setPlayerList] = useState([])
  const [isPoolMade, setIsPoolMade] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [rosters, setRosters] = useState([[], []])
  const [turn, setTurn] = useState(1)
  const PAGES = 46002
  const POOL_SIZE = 10
  const SKILL_LEVEL = 20
  const SHOW_TEAM = true

  const draft = (draftee) => {
    const draftedList = playerList.filter((player) => player !== draftee)
    setPlayerList(draftedList)
    if (turn === 1) {
      setRosters([[...rosters[0], draftee], rosters[1]])
    } else {
      setRosters([rosters[0], [...rosters[1], draftee]])
    }
    setTurn(turn * -1)
  }

  const getPlayerPool = async () => {
    setIsLoading(true)
    const playerPool = []

    while (playerPool.length < POOL_SIZE) {
      const player = await fetchPlayer()

      if (
        Object.values(player.stats).reduce((a, b) => a + b, 0) >= SKILL_LEVEL
      ) {
        console.log(player)
        playerPool.push(player)
      } else {
        console.log('bum')
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
    if (playerList.length === 0) {
      return <Calculator rosters={rosters} />
    } else
      return (
        <Main>
          <PlayerPool>
            <Typography>Player Pool</Typography>
            {playerList.map((player) => {
              return (
                <Player key={`${player.name}${player.date}`} disablePadding>
                  <ListItemButton onClick={() => draft(player)}>
                    <PlayerText
                      primary={player.name}
                      secondary={SHOW_TEAM ? player.team : ''}
                    />
                  </ListItemButton>
                </Player>
              )
            })}
          </PlayerPool>

          <Roster>
            <Typography>Team 1</Typography>
            {rosters[0].map((player) => {
              return (
                <Player key={`${player.name}${player.date}`}>
                  <PlayerText
                    primary={player.name}
                    secondary={SHOW_TEAM ? player.team : ''}
                  />
                </Player>
              )
            })}
          </Roster>

          <Roster>
            <Typography>Team 2</Typography>
            {rosters[1].map((player) => {
              return (
                <Player key={`${player.name}${player.date}`}>
                  <PlayerText
                    primary={player.name}
                    secondary={SHOW_TEAM ? player.team : ''}
                  />
                </Player>
              )
            })}
          </Roster>
        </Main>
      )
  } else if (isLoading) {
    return (
      <Center>
        <CircularProgress />
      </Center>
    )
  } else
    return (
      <Center>
        <Container>
          <Typography variant="h3" mb={4}>
            Fantasy Pickup
          </Typography>
          <FetchButton variant="contained" onClick={getPlayerPool}>
            ROLL PLAYER
          </FetchButton>
        </Container>
      </Center>
    )
}

const Main = styled.div`
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: 1fr;
  gap: 0px 0px;
  grid-template-areas: '. . .';
`

const FetchButton = styled(Button)``

const PlayerPool = styled(List)`
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  width: fit-content;
`

const Roster = styled(List)`
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  width: fit-content;
`

const Player = styled(ListItem)`
  width: fit-content;
`

const PlayerText = styled(ListItemText)``

const Center = styled.div`
  height: 100vh;
  display: grid;
  place-items: Center;
`

const Container = styled.div`
  display: flex;
  flex-direction: column;
`

export default App
