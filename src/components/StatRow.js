import { TableRow, TableCell } from '@mui/material'
import '../App.css'

export default function StatRow(props) {
  const rosters = props.rosters
  const stat = props.stat

  const sumStat = (playerStat, player) => {
    const sum = rosters[player].reduce((a, b) => {
      return a + b['stats'][playerStat]
    }, 0)

    if (stat === 'fgp' || stat === 'ftp') {
      return (sum / rosters[player].length).toFixed(2)
    } else {
      return sum
    }
  }

  let teamOneWin = sumStat(stat, 0) > sumStat(stat, 1) ? 'grey' : ''
  teamOneWin = stat === 'to' ? !teamOneWin : teamOneWin

  const getCatagory = (catagory) => {
    if (stat === 'fgp') {
      return 'FG%'
    } else if (stat === 'ftp') {
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
