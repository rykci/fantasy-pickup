import { Table, TableHead, TableRow, TableCell } from '@mui/material'

export default function BoxScore(props) {
  const rosters = props.rosters

  return (
    <>
      <Table className="boxScore">
        <TableHead>
          <TableRow>
            <TableCell align="left"> Team 1 </TableCell>
          </TableRow>
          <TableRow>
            <TableCell align="left"> Player </TableCell>
            <TableCell align="right">FG%</TableCell>
            <TableCell align="right">FT%</TableCell>
            <TableCell align="right">3PTM</TableCell>
            <TableCell align="right">PTS</TableCell>
            <TableCell align="right">REB</TableCell>
            <TableCell align="right">AST</TableCell>
            <TableCell align="right">STL</TableCell>
            <TableCell align="right">BLK</TableCell>
            <TableCell align="right">TO</TableCell>
          </TableRow>
        </TableHead>
        {rosters[0].map((player, i) => {
          return (
            <TableRow key={i}>
              <TableCell align="left"> {player.name} </TableCell>
              <TableCell align="right">{player.stats.fgp}</TableCell>
              <TableCell align="right">{player.stats.ftp}</TableCell>
              <TableCell align="right">{player.stats.fg3m}</TableCell>
              <TableCell align="right">{player.stats.pts}</TableCell>
              <TableCell align="right">{player.stats.reb}</TableCell>
              <TableCell align="right">{player.stats.ast}</TableCell>
              <TableCell align="right">{player.stats.stl}</TableCell>
              <TableCell align="right">{player.stats.blk}</TableCell>
              <TableCell align="right">{player.stats.to}</TableCell>
            </TableRow>
          )
        })}
      </Table>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell align="left"> Team 2 </TableCell>
          </TableRow>
          <TableRow>
            <TableCell align="left"> Player </TableCell>
            <TableCell align="right">FG%</TableCell>
            <TableCell align="right">FT%</TableCell>
            <TableCell align="right">3PTM</TableCell>
            <TableCell align="right">PTS</TableCell>
            <TableCell align="right">REB</TableCell>
            <TableCell align="right">AST</TableCell>
            <TableCell align="right">STL</TableCell>
            <TableCell align="right">BLK</TableCell>
            <TableCell align="right">TO</TableCell>
          </TableRow>
        </TableHead>
        {rosters[1].map((player, j) => {
          return (
            <TableRow key={j}>
              <TableCell align="left"> {player.name} </TableCell>
              <TableCell align="right">{player.stats.fgp}</TableCell>
              <TableCell align="right">{player.stats.ftp}</TableCell>
              <TableCell align="right">{player.stats.fg3m}</TableCell>
              <TableCell align="right">{player.stats.pts}</TableCell>
              <TableCell align="right">{player.stats.reb}</TableCell>
              <TableCell align="right">{player.stats.ast}</TableCell>
              <TableCell align="right">{player.stats.stl}</TableCell>
              <TableCell align="right">{player.stats.blk}</TableCell>
              <TableCell align="right">{player.stats.to}</TableCell>
            </TableRow>
          )
        })}
      </Table>
    </>
  )
}
