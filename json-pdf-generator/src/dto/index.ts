import {
  IsString,
  IsArray,
  IsBoolean,
  ArrayMinSize,
  IsOptional,
  ValidateNested,
  IsIn,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ParagraphItemDto {
  @IsIn(['paragraph'])
  type: 'paragraph';

  @IsString()
  text: string;

  @IsOptional()
  @IsIn(['left', 'center', 'right', 'justify'])
  align?: 'left' | 'center' | 'right' | 'justify';

  @IsOptional()
  @IsString()
  style?: string;
}

export class TableItemDto {
  @IsIn(['table'])
  type: 'table';

  @IsArray()
  headers: (string | { text: string; style?: string })[];

  @IsArray()
  rows: (string | { text: string; style?: string })[][];

  @IsOptional()
  @IsString()
  style?: string;
}

export class BulletListItemDto {
  @IsIn(['bulletList'])
  type: 'bulletList';

  @IsArray()
  @ArrayMinSize(1)
  items: (string | { text: string; style?: string })[];

  @IsOptional()
  @IsString()
  style?: string;
}

export class ImageItemDto {
  @IsIn(['image'])
  type: 'image';

  @IsString()
  src: string;

  @IsOptional()
  @IsString()
  width?: string;

  @IsOptional()
  @IsString()
  height?: string;

  @IsOptional()
  @IsIn(['left', 'center', 'right'])
  align?: 'left' | 'center' | 'right';

  @IsOptional()
  @IsString()
  style?: string;
}

export class GridColumnDto {
  @IsOptional()
  @IsString()
  width?: string;

  @IsOptional()
  @IsIn(['left', 'center', 'right'])
  align?: 'left' | 'center' | 'right';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => Object)
  content: (ParagraphItemDto | TableItemDto | BulletListItemDto | ImageItemDto)[];
}

export class GridItemDto {
  @IsIn(['grid'])
  type: 'grid';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GridColumnDto)
  columns: GridColumnDto[];

  @IsOptional()
  @IsString()
  gap?: string;

  @IsOptional()
  @IsString()
  style?: string;
}

export class PdfSectionDto {
  @IsString()
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => Object)
  content: (ParagraphItemDto | TableItemDto | BulletListItemDto | GridItemDto | ImageItemDto)[];

  @IsOptional()
  @IsString()
  style?: string;
}

export class PdfHeaderDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  logoStyle?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Full-width header image — replaces logo+title+description when provided */
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  showOnAllPages?: boolean;
}

export class PdfFooterDto {
  @IsString()
  text: string;
}

export class PdfLayoutDto {
  @IsOptional()
  @IsString()
  headerHeight?: string;

  @IsOptional()
  @IsString()
  footerHeight?: string;

  @IsOptional()
  @IsString()
  bodyPaddingTop?: string;

  @IsOptional()
  @IsString()
  bodyPaddingBottom?: string;

  @IsOptional()
  @IsString()
  marginLeft?: string;

  @IsOptional()
  @IsString()
  marginRight?: string;
}

export class PdfDocumentDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PdfHeaderDto)
  header?: PdfHeaderDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PdfSectionDto)
  body: PdfSectionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PdfFooterDto)
  footer?: PdfFooterDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PdfLayoutDto)
  layout?: PdfLayoutDto;
}

export class PdfOutputConfigDto {
  @IsOptional()
  @IsString()
  s3Bucket?: string;

  @IsOptional()
  @IsString()
  s3Folder?: string;
}

export class PdfGenerateRequestDto {
  @IsString()
  template: string;

  @IsObject()
  data: Record<string, any>;

  @IsOptional()
  @ValidateNested()
  @Type(() => PdfOutputConfigDto)
  output?: PdfOutputConfigDto;
}
