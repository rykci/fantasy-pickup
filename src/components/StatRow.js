import { TableRow, TableCell } from '@mui/material'
import '../App.css'

export default function StatRow(props) {
  const rosters = props.rosters
  let stat = props.stat;

  if (stat === 'fgp') { 
    stat = 'fgm'
  } else if (stat === 'ftp') { 
    stat = 'ftm' 
  }

  const sumStat = (playerStat, player) => {

    const sum = rosters[player].reduce((a, b) => {
      return a + b['stats'][playerStat]
    }, 0)

    if (stat === 'fgm' || stat === 'ftm') {
      console.log(playerStat.substring(0,2) + 'a')
      const sumAttempts = rosters[player].reduce((a, b) => {
        return a + b['stats'][playerStat.substring(0,2) + 'a']
      }, 0)
      return (sum/sumAttempts).toFixed(2)
    } else {
      return sum
    }
  }

  let teamOneWin = sumStat(stat, 0) > sumStat(stat, 1) ? 'grey' : ''
  teamOneWin = stat === 'to' ? !teamOneWin : teamOneWin

  const getCatagory = (catagory) => {
    if (stat === 'fgm') {
      return 'FG%'
    } else if (stat === 'ftm') {
      return 'FT% '
    } else if (stat === 'fg3m') {
      return '3PTM'
    } else {
      return catagory.toUpperCase()
    }
  }

  return (
    <TableRow>
      <TableCell
        className={
          teamOneWin || sumStat(stat, 0) === sumStat(stat, 1) ? 'grey' : ''
        }
        align="right"
      >
        {sumStat(stat, 0)}
      </TableCell>
      <TableCell align="center">{getCatagory(stat)}</TableCell>
      <TableCell align="left" className={!teamOneWin ? 'grey' : ''}>
        {sumStat(stat, 1)}
      </TableCell>
    </TableRow>
  )
}
