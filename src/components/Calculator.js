import styled from 'styled-components'
import { Table, TableHead, TableRow, TableCell, TableBody } from '@mui/material'
import StatRow from './StatRow'
import BoxScore from './BoxScore'

export default function Calculator(props) {
  const rosters = props.rosters

  return (
    <Grid>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell align="right"> Team 1</TableCell>
            <TableCell align="center">Catagory</TableCell>
            <TableCell align="left">Team 2</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <StatRow rosters={rosters} stat={'fgp'} />
          <StatRow rosters={rosters} stat={'ftp'} />
          <StatRow rosters={rosters} stat={'fg3m'} />
          <StatRow rosters={rosters} stat={'pts'} />
          <StatRow rosters={rosters} stat={'reb'} />
          <StatRow rosters={rosters} stat={'ast'} />
          <StatRow rosters={rosters} stat={'stl'} />
          <StatRow rosters={rosters} stat={'blk'} />
          <StatRow rosters={rosters} stat={'to'} />
        </TableBody>
      </Table>
      <BoxScore rosters={rosters} />
    </Grid>
  )
}

const Grid = styled.div`
  display: grid;
  place-items: center;
`
