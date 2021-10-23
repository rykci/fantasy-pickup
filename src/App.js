import './App.css';
import { useState } from 'react'


function App() {

  const [data, setData] = useState({
    player: {first_name: "", last_name:""},
    team: {full_name:""},
    game: {date:""},
    pts: "",
    ast: "",
    reb: "",
    stl: "",
    blk: "",
  })
  const PAGES = 45970;


  const fetchData = async () => {
    const page = Math.floor(Math.random() * PAGES) + 1
    const index = Math.floor(Math.random() * 25)

    //https://rapidapi.com/theapiguy/api/free-nba/
    await fetch(`https://free-nba.p.rapidapi.com/stats?page=${page}`, {
      "method": "GET",
      "headers": {
        "x-rapidapi-host": "free-nba.p.rapidapi.com",
        "x-rapidapi-key": "21c9356c99mshc029bf82afeabf7p101ad3jsn1abb9005eb40"
      }
    })
    .then(response => {
      response.json().then(res => {
        const playerData = res.data[index];
        if (playerData.pts + playerData.ast + playerData.reb + playerData.blk + playerData.stl< 20) {
          fetchData()
        } else {
        setData(res.data[index]);
        console.log(res.data[index])
        }
      });
    })
    .catch(err => {
      console.error(err);
    });
  }

  return (
    <div className="App">
      <header className="App-header">
        <h2>{data.player.first_name} {data.player.last_name}</h2>
        <h3>'{data.game.date.substring(2,4)} {data.team.full_name}</h3>
        <h3>{(data.game.date).split("T")[0]}</h3>
        <h3>PTS: {data.pts || 0}</h3>
        <h3>AST: {data.ast || 0}</h3>
        <h3>REB: {data.reb || 0}</h3>
        <h3>STL: {data.stl || 0}</h3>
        <h3>BLK: {data.blk || 0}</h3>
        <button onClick={fetchData}>ROLL PLAYER</button>
      </header>
    </div>
  );
}

export default App;
