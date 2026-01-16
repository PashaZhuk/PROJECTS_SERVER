import express from 'express'
import cors from 'cors'
import { config } from 'dotenv';
import  {connectDB}  from './config/db';

config();
connectDB();
const app = express();
const PORT = 5001;

//body parsing middlewares
app.use(cors())
app.use(express.json());
app.use(express.urlencoded({extended:true}))


// app.use('/movies', movieRoutes)
app.use('/auth', (req,res)=>{
    res.json({message:'qqqq'})
})
// app.use('/watchlist', watchListRoutes)


app.listen(PORT,()=>{
    console.log(`Server runnig on PORT ${PORT}`)
})