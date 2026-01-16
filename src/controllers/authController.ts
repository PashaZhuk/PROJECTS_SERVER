import {prisma} from '../config/db.js'
import bcrypt from 'bcrypt'
import {generateToken} from '../utils/generateToken.js'

const register = async(req, res)=>{
    const{name,email,password,surename} = req.body

    // Check if user already exist
    const userExist = await prisma.user.findUnique({
        where: {email:email}
    });
    if (userExist){
        return  res
        .status(400)
        .json({error:"User is already exists with this email"})
    }

    //Hash Password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password,salt)

    //create User
    const user = await prisma.user.create({
        data:{
            name,
            email,
            password: hashedPassword,
            surename: surename,
           
        },
    })
    

    //Generate JWT Token

    const token = generateToken(user.id, res)
    console.log(token)

    res.status(201).json({
        status:"success",
        data:{
            user:{
                id:user.id,
                name:name,
                email:email,
                surename: surename,
            },
            token,
        }

    })


}

const login = async(req,res)=>{
    const{email,password} = req.body
    // Check if user email exist in the table
    const user = await prisma.user.findUnique({
        where: {email : email}
    });
    if (!user){
        return  res
        .status(401)
        .json({error:"Invalid user email or password"})
    }
    //verify the password
    const isPasswordValid = await bcrypt.compare(password, user.password)
    if(!isPasswordValid){
        return  res.status(401).json({error:"Invalid user email or password"})
    }
    //Generate JWT Token

    const token = generateToken(user.id, res)

    
    res.status(201).json({
        status:"success",
        data:{
            user:{
                id:user.id,
                email:email,
                
                },
                token
                }
                })}

const logout = async (req,res) =>{
    res.cookie("jwt","",{
        httpOnly:true,
        expires: new Date(0),
    })
    res.status(200).json({
        status:"success",
        message:"Logged out succesfukky"
    })
}

export {register,login,logout}