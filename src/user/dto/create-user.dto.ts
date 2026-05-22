import { Role } from '../user.interface';

export class CreateUserDto {
  name: string;
  email: string;
  password: string;
  role?: Role;
  phone?: string;
  picture?: string;
  address?: string;
  nidNumber?: string;
  nidImage?: string[];
}
